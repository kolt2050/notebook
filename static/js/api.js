/**
 * API layer using chrome.storage.local for the Notebook browser extension.
 * All data is stored locally in the browser — no server required.
 * 
 * Storage structure:
 *   "notebook_documents" -> [ { id, parent_id, title, content, is_folder, position, created_at, updated_at }, ... ]
 *   "notebook_next_id"   -> <next integer id to assign>
 *   "notebook_images"    -> [ { id, document_id, filename, data (base64), content_type }, ... ]
 *   "notebook_next_img_id" -> <next image id>
 */

const STORAGE_KEYS = {
  DOCS: 'notebook_documents',
  NEXT_ID: 'notebook_next_id',
  IMAGES: 'notebook_images',
  NEXT_IMG_ID: 'notebook_next_img_id',
  SHORTCUTS: 'notebook_shortcuts',
};

// Helper: read from storage
function _get(key) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(key, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(result[key]);
      }
    });
  });
}

// Helper: write to storage
function _set(obj) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(obj, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

// Helper: get all documents
async function _getAllDocs() {
  const docs = await _get(STORAGE_KEYS.DOCS);
  return Array.isArray(docs) ? docs : [];
}

// Helper: get next ID and increment
async function _getNextId() {
  let nextId = await _get(STORAGE_KEYS.NEXT_ID);
  if (!nextId || typeof nextId !== 'number') nextId = 1;
  await _set({ [STORAGE_KEYS.NEXT_ID]: nextId + 1 });
  return nextId;
}

// Helper: save all documents
async function _saveAllDocs(docs) {
  await _set({ [STORAGE_KEYS.DOCS]: docs });
}

// Helper: strip HTML tags to get plain text
function _getPlainText(html) {
  if (!html) return '';
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent || div.innerText || '';
}

function _getExportText(html) {
  if (!html) return '';

  const div = document.createElement('div');
  div.innerHTML = html;

  div.querySelectorAll('br').forEach(br => br.replaceWith('\n'));

  const blockTags = new Set(['DIV', 'P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'BLOCKQUOTE']);
  const parts = [];

  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.nodeValue);
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const isBlock = blockTags.has(node.tagName);
    if (node.tagName === 'LI') parts.push('- ');
    if (node.tagName === 'IMG') {
      const alt = node.getAttribute('alt') || node.getAttribute('title') || 'Image';
      parts.push(`[${alt}]`);
    }

    node.childNodes.forEach(walk);

    if (isBlock) parts.push('\n');
  };

  div.childNodes.forEach(walk);

  return parts
    .join('')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function _normalizeExportText(text) {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function _getPdfExportBlocks(html) {
  if (!html) return [];

  const div = document.createElement('div');
  div.innerHTML = html;
  div.querySelectorAll('br').forEach(br => br.replaceWith(document.createTextNode('\n')));

  const blockTags = new Set(['DIV', 'P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'BLOCKQUOTE']);
  const blocks = [];
  let textParts = [];

  const flushText = () => {
    const text = _normalizeExportText(textParts.join(''));
    if (text) blocks.push({ type: 'text', text });
    textParts = [];
  };

  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      textParts.push(node.nodeValue);
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    if (node.tagName === 'IMG') {
      flushText();
      blocks.push({
        type: 'image',
        src: node.getAttribute('src') || '',
        alt: node.getAttribute('alt') || node.getAttribute('title') || 'Image'
      });
      return;
    }

    const isBlock = blockTags.has(node.tagName);
    if (node.tagName === 'LI') textParts.push('- ');

    node.childNodes.forEach(walk);

    if (isBlock) textParts.push('\n\n');
  };

  div.childNodes.forEach(walk);
  flushText();

  return blocks;
}

const API = {
  normalizeShortcutPages(pages) {
    let changed = false;
    if (!Array.isArray(pages) || pages.length === 0) {
      return {
        pages: [{ id: 'page_1', title: 'Лист 1', type: 'shortcut', shortcuts: [] }],
        changed: true
      };
    }

    const normalized = pages.map((page, index) => {
      const nextPage = { ...page };
      if (!nextPage.id) {
        nextPage.id = 'page_' + Date.now() + '_' + index;
        changed = true;
      }
      if (!nextPage.title) {
        nextPage.title = `Лист ${index + 1}`;
        changed = true;
      }
      if (!nextPage.type) {
        nextPage.type = 'shortcut';
        changed = true;
      }

      if (nextPage.type === 'deadline') {
        if (!Array.isArray(nextPage.items)) {
          nextPage.items = [];
          changed = true;
        }
      } else {
        nextPage.type = 'shortcut';
        if (!Array.isArray(nextPage.shortcuts)) {
          nextPage.shortcuts = [];
          changed = true;
        }
      }

      return nextPage;
    });

    return { pages: normalized, changed };
  },

  async getTree() {
    const docs = await _getAllDocs();
    // Sort by position, then id
    docs.sort((a, b) => (a.position - b.position) || (a.id - b.id));

    const docMap = {};
    docs.forEach(doc => {
      docMap[doc.id] = {
        id: doc.id,
        title: doc.title,
        is_folder: doc.is_folder,
        parent_id: doc.parent_id,
        position: doc.position,
        children: []
      };
    });

    const tree = [];
    docs.forEach(doc => {
      const item = docMap[doc.id];
      if (doc.parent_id === null || doc.parent_id === undefined) {
        tree.push(item);
      } else {
        const parent = docMap[doc.parent_id];
        if (parent) {
          parent.children.push(item);
        } else {
          // Orphan — put at root
          tree.push(item);
        }
      }
    });

    return tree;
  },

  async getDocument(id) {
    const docs = await _getAllDocs();
    const doc = docs.find(d => d.id === id);
    if (!doc) throw new Error('Document not found');
    return { ...doc };
  },

  async createDocument(data) {
    const docs = await _getAllDocs();
    const newId = await _getNextId();
    const now = new Date().toISOString();

    const newDoc = {
      id: newId,
      parent_id: (data.parent_id && data.parent_id > 0) ? data.parent_id : null,
      title: data.title || 'New Document',
      content: data.content || '',
      is_folder: data.is_folder || 0,
      position: data.position !== undefined ? data.position : docs.length,
      created_at: now,
      updated_at: null
    };

    // Prevent self-reference
    if (newDoc.parent_id === newDoc.id) {
      newDoc.parent_id = null;
    }

    docs.push(newDoc);
    await _saveAllDocs(docs);
    return { ...newDoc };
  },

  async updateDocument(id, data) {
    const docs = await _getAllDocs();
    const idx = docs.findIndex(d => d.id === id);
    if (idx === -1) throw new Error('Document not found');

    // Prevent self-reference
    if (data.parent_id !== undefined && data.parent_id === id) {
      data.parent_id = null;
    }

    const updateData = data;
    for (const key of Object.keys(updateData)) {
      if (updateData[key] !== undefined && updateData[key] !== null) {
        docs[idx][key] = updateData[key];
      }
    }
    docs[idx].updated_at = new Date().toISOString();

    await _saveAllDocs(docs);
    return { ...docs[idx] };
  },

  async deleteDocument(id) {
    let docs = await _getAllDocs();
    // Collect IDs to delete (document + all descendants)
    const toDelete = new Set();
    toDelete.add(id);

    // Recursively find all descendants
    let changed = true;
    while (changed) {
      changed = false;
      for (const doc of docs) {
        if (toDelete.has(doc.parent_id) && !toDelete.has(doc.id)) {
          toDelete.add(doc.id);
          changed = true;
        }
      }
    }

    // Also delete associated images
    let images = await _get(STORAGE_KEYS.IMAGES);
    if (Array.isArray(images)) {
      images = images.filter(img => !toDelete.has(img.document_id));
      await _set({ [STORAGE_KEYS.IMAGES]: images });
    }

    docs = docs.filter(d => !toDelete.has(d.id));
    await _saveAllDocs(docs);
    return true;
  },

  async deleteAllDocuments() {
    await _set({
      [STORAGE_KEYS.DOCS]: [],
      [STORAGE_KEYS.NEXT_ID]: 1,
      [STORAGE_KEYS.IMAGES]: [],
      [STORAGE_KEYS.NEXT_IMG_ID]: 1
    });
    return true;
  },

  async getDocCount() {
    const docs = await _getAllDocs();
    return docs.length;
  },

  async search(query) {
    if (!query || query.length < 1) {
      return { matches: [], ancestors: [] };
    }

    const docs = await _getAllDocs();
    const queryLower = query.toLowerCase();

    const matchIds = new Set();
    const docMap = {};
    docs.forEach(doc => {
      docMap[doc.id] = doc;
      const titleMatch = doc.title && doc.title.toLowerCase().includes(queryLower);
      const contentMatch = doc.content && _getPlainText(doc.content).toLowerCase().includes(queryLower);
      if (titleMatch || contentMatch) {
        matchIds.add(doc.id);
      }
    });

    // Find ancestors
    const ancestorIds = new Set();
    for (const docId of matchIds) {
      let parentId = docMap[docId] ? docMap[docId].parent_id : null;
      while (parentId !== null && parentId !== undefined) {
        ancestorIds.add(parentId);
        const parentDoc = docMap[parentId];
        parentId = parentDoc ? parentDoc.parent_id : null;
      }
    }

    return {
      matches: Array.from(matchIds),
      ancestors: Array.from(ancestorIds)
    };
  },

  // --- Shortcuts for Dashboard ---
  async getShortcutPages() {
    let pages = await _get('notebook_shortcut_pages');
    if (!pages) {
      // Migrate from old shortcuts
      const oldShortcuts = await _get(STORAGE_KEYS.SHORTCUTS);
      const defaultShortcuts = Array.isArray(oldShortcuts) ? oldShortcuts : [
        { id: '1', title: 'Google', url: 'https://google.com', icon: '🔍' },
        { id: '2', title: 'GitHub', url: 'https://github.com', icon: '💻' }
      ];
      pages = [
        { id: 'page_1', title: 'Лист 1', shortcuts: defaultShortcuts }
      ];
      await _set({ 'notebook_shortcut_pages': pages });
    }
    const normalized = this.normalizeShortcutPages(pages);
    pages = normalized.pages;
    if (normalized.changed) {
      await _set({ 'notebook_shortcut_pages': pages });
    }
    return pages;
  },

  async saveShortcutPages(pages) {
    const normalized = this.normalizeShortcutPages(pages);
    await _set({ 'notebook_shortcut_pages': normalized.pages });
  },

  async getShortcuts() {
    const pages = await this.getShortcutPages();
    return pages[0].shortcuts; // Fallback for old code if any
  },

  async saveShortcuts(shortcuts) {
    const pages = await this.getShortcutPages();
    pages[0].shortcuts = shortcuts;
    await this.saveShortcutPages(pages);
  },

  // --- Export all documents as Markdown ---
  async getMarkdownExportDocuments() {
    const docs = await _getAllDocs();
    const docMap = {};

    docs.forEach(doc => {
      docMap[doc.id] = {
        id: doc.id,
        title: doc.title,
        content: doc.content || '',
        parent_id: doc.parent_id,
        children: []
      };
    });

    const roots = [];
    docs.forEach(doc => {
      const item = docMap[doc.id];
      const parent = doc.parent_id !== null && doc.parent_id !== undefined ? docMap[doc.parent_id] : null;
      if (parent) {
        parent.children.push(item);
      } else {
        roots.push(item);
      }
    });

    const sortByVisibleTitle = (items) => {
      items.sort((a, b) => (a.title || '').localeCompare(b.title || '', undefined, { numeric: true, sensitivity: 'base' }));
      items.forEach(item => sortByVisibleTitle(item.children));
      return items;
    };

    const result = [];
    const flatten = (items, depth = 0) => {
      items.forEach(item => {
        result.push({
          id: item.id,
          title: item.title || 'Untitled',
          depth,
          content: item.content || ''
        });
        flatten(item.children, depth + 1);
      });
    };

    flatten(sortByVisibleTitle(roots));
    return result;
  },

  async getPdfExportDocuments() {
    const docs = await _getAllDocs();
    const docMap = {};

    docs.forEach(doc => {
      docMap[doc.id] = {
        ...doc,
        children: []
      };
    });

    const roots = [];
    docs.forEach(doc => {
      const item = docMap[doc.id];
      const parent = doc.parent_id !== null && doc.parent_id !== undefined ? docMap[doc.parent_id] : null;
      if (parent) {
        parent.children.push(item);
      } else {
        roots.push(item);
      }
    });

    const sortByVisibleTitle = (items) => {
      items.sort((a, b) => (a.title || '').localeCompare(b.title || '', undefined, { numeric: true, sensitivity: 'base' }));
      items.forEach(item => sortByVisibleTitle(item.children));
      return items;
    };

    const result = [];
    const flatten = (items, ancestors = []) => {
      items.forEach(item => {
        const title = item.title || 'Untitled';
        const pathParts = ancestors.concat(title);
        result.push({
          id: item.id,
          title,
          path: pathParts.join(' / '),
          depth: ancestors.length,
          content: _getExportText(item.content),
          blocks: _getPdfExportBlocks(item.content)
        });
        flatten(item.children, pathParts);
      });
    };

    flatten(sortByVisibleTitle(roots));
    return result;
  },

  // --- Backup: export all data as JSON ---
  async backupData() {
    const docs = await _getAllDocs();
    const images = await _get(STORAGE_KEYS.IMAGES);
    const nextId = await _get(STORAGE_KEYS.NEXT_ID);
    return {
      documents: docs,
      images: Array.isArray(images) ? images : [],
      next_id: nextId || 1,
      exported_at: new Date().toISOString(),
      version: 1
    };
  },

  async backupShortcuts() {
    const pages = await this.getShortcutPages();
    return {
      pages: pages,
      exported_at: new Date().toISOString(),
      version: 2,
      type: 'shortcuts'
    };
  },

  // --- Import: replace all data from JSON ---
  async importData(data) {
    if (!data || !Array.isArray(data.documents)) {
      throw new Error('Invalid import data: missing documents array');
    }

    await _set({
      [STORAGE_KEYS.DOCS]: data.documents,
      [STORAGE_KEYS.NEXT_ID]: data.next_id || (Math.max(0, ...data.documents.map(d => d.id)) + 1),
      [STORAGE_KEYS.IMAGES]: Array.isArray(data.images) ? data.images : [],
      [STORAGE_KEYS.NEXT_IMG_ID]: data.next_img_id || 1
    });

    return { status: 'success', message: 'Database imported successfully' };
  },

  async importShortcuts(data) {
    if (!data) throw new Error('Invalid import data');
    
    if (data.version === 2 && Array.isArray(data.pages)) {
      await this.saveShortcutPages(data.pages);
    } else if (Array.isArray(data.shortcuts)) {
      // Legacy import
      const pages = [
        { id: 'page_1', title: 'Лист 1', shortcuts: data.shortcuts }
      ];
      await this.saveShortcutPages(pages);
    } else {
      throw new Error('Invalid import data: missing shortcuts array or pages array');
    }

    return { status: 'success', message: 'Shortcuts imported successfully' };
  }
};
