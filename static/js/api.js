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

const API = {
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

  // --- Export all documents as Markdown ---
  async exportAllMarkdown() {
    const docs = await _getAllDocs();
    // Sort by position
    docs.sort((a, b) => (a.position - b.position) || (a.id - b.id));

    let md = '';
    docs.forEach(doc => {
      const plainContent = _getPlainText(doc.content);
      md += `# ${doc.title}\n\n${plainContent}\n\n---\n\n`;
    });

    return md.trim();
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
  }
};
