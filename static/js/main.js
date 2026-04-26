const Main = {
    async init() {
        try {
            if (typeof TurndownService !== 'undefined') {
                this.turndown = new TurndownService({
                    headingStyle: 'atx',
                    codeBlockStyle: 'fenced',
                    blankReplacement: function (content, node) {
                        // For blank nodes (empty divs, br-only divs), return single newline
                        return '\n';
                    }
                });

                // Custom rule: properly handle all <pre> blocks (with or without <code>)
                this.turndown.addRule('fencedCodeBlock', {
                    filter: function (node) {
                        return node.nodeName === 'PRE';
                    },
                    replacement: function (content, node) {
                        const code = node.querySelector('code');
                        // Use textContent to strip all hljs <span> tags
                        let text = code ? code.textContent : node.textContent;
                        // Remove leading/trailing newlines only
                        text = text.replace(/^\n+/, '').replace(/\n+$/, '');
                        // Detect language from <code> class
                        let lang = '';
                        if (code) {
                            const langClass = Array.from(code.classList).find(c => c.startsWith('language-'));
                            lang = langClass ? langClass.replace('language-', '') : '';
                            // Strip "hljs" from lang if present (e.g. "python hljs" → "python")
                            lang = lang.replace(/\s*hljs\s*/, '').trim();
                        }
                        return '\n\n```' + lang + '\n' + text + '\n```\n\n';
                    }
                });

                // Add rule to skip empty bold/italic tags that cause ** on empty lines
                this.turndown.addRule('skipEmptyEmphasis', {
                    filter: ['strong', 'b', 'em', 'i'],
                    replacement: function (content) {
                        return content.trim() ? '**' + content + '**' : content;
                    }
                });

                // Add rule to preserve images with custom dimensions/styles
                this.turndown.addRule('preserveResizedImages', {
                    filter: function (node) {
                        return node.nodeName === 'IMG' && (node.getAttribute('style') || node.getAttribute('width'));
                    },
                    replacement: function (content, node) {
                        return node.outerHTML;
                    }
                });
            } else {
                console.warn('TurndownService not found, Markdown export will be limited.');
            }

            if (typeof marked !== 'undefined') {
                marked.setOptions({
                    headerIds: false,
                    mangle: false,
                    gfm: true,
                    breaks: true
                });
            }
        } catch (e) {
            console.error('Failed to init converters:', e);
        }

        try {
            await Tree.refresh();
        } catch (err) {
            console.error('Failed to load tree:', err);
        }

        // Initialize localization
        I18n.init();

        // Add event listeners
        this.addEventListeners();
        this.initResizer();
        this.refreshStats();

        // Auto-save every 5 minutes
        setInterval(() => {
            console.log('[Auto-save] Periodic trigger');
            Editor.save();
        }, 5 * 60 * 1000);

        await this.loadShortcuts();
        this.showDashboard();
    },

    async loadShortcuts() {
        const shortcuts = await API.getShortcuts();
        const container = document.getElementById('shortcuts-container');
        if (!container) return;

        container.innerHTML = '';
        shortcuts.forEach(s => {
            const card = document.createElement('div');
            card.className = 'shortcut-card';

            let targetUrl = s.url.trim();
            // Remove wrapping quotes if the user pasted them
            if ((targetUrl.startsWith('"') && targetUrl.endsWith('"')) || (targetUrl.startsWith("'") && targetUrl.endsWith("'"))) {
                targetUrl = targetUrl.slice(1, -1);
            }

            if (/^[a-zA-Z]:[\\/]/.test(targetUrl)) {
                targetUrl = 'file:///' + targetUrl.replace(/\\/g, '/');
            }

            card.innerHTML = `
                <div class="shortcut-actions-overlay">
                    <button class="shortcut-action-btn edit-btn" title="Edit">✏️</button>
                    <button class="shortcut-action-btn delete-btn" title="Delete">🗑️</button>
                </div>
                <div class="shortcut-icon">${s.icon || '🔗'}</div>
                <div class="shortcut-title">${s.title}</div>
            `;
            
            card.onclick = (e) => {
                if (e.target.closest('.shortcut-actions-overlay')) return;
                
                if (targetUrl.startsWith('file:///')) {
                    if (chrome && chrome.tabs && chrome.tabs.create) {
                        chrome.tabs.create({ url: targetUrl });
                    } else {
                        window.open(targetUrl, '_blank');
                    }
                } else {
                    window.open(targetUrl, '_blank');
                }
            };

            const editBtn = card.querySelector('.edit-btn');
            editBtn.onclick = (e) => { e.stopPropagation(); this.editShortcut(s.id); };
            
            const deleteBtn = card.querySelector('.delete-btn');
            deleteBtn.onclick = (e) => { e.stopPropagation(); this.deleteShortcut(s.id); };

            container.appendChild(card);
        });

        const addBtn = document.createElement('div');
        addBtn.className = 'shortcut-card add-shortcut';
        addBtn.textContent = '+ Add';
        addBtn.onclick = () => this.addShortcut();
        container.appendChild(addBtn);
    },

    getIconSelectionHTML(selectedIcon = '🌐') {
        const icons = [
            '🌐', '📁', '📄', '⚙️', '💻', '📱', '🎵', '🎮', '📚', '✉️', '📅', '📊', '🔍', '🎨', '🔐', '🛠️', '☁️', '🌟', '💡', '🏠', '🚀', '🤖', '💰', '🛒',
            '🎬', '📷', '🎤', '🍕', '☕', '🍺', '🏋️', '🚵', '🌍', '📍', '⏰', '🔋', '📡', '💾', '🔑', '📝', '📌', '📈', '📉', '📎', '🔗', '📂', '📆', '📫', 
            '📦', '🔔', '🔥', '💧', '⚡', '🌈', '🍎', '🍔', '🍦', '⚽', '🎾', '🎸', '🕹️', '📟', '📠', '📺', '📻', '🧭', '🔭', '🔬', '🧺', '🧼', '🧸'
        ];
        let html = '<div style="font-size: 0.9em; margin-top: 5px; color: var(--text-dim);">Select Icon:</div>';
        html += '<div class="icon-grid" style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 5px; justify-content: flex-start; max-height: 180px; overflow-y: auto; padding-right: 5px;">';
        icons.forEach(icon => {
            const isSelected = icon === selectedIcon ? 'selected' : '';
            const borderStyle = isSelected ? 'border: 2px solid var(--accent-color); background: rgba(88,166,255,0.1);' : 'border: 2px solid transparent;';
            html += `<div class="icon-option ${isSelected}" data-icon="${icon}" style="font-size: 1.6rem; cursor: pointer; padding: 4px; border-radius: 6px; transition: all 0.2s; ${borderStyle}">${icon}</div>`;
        });
        html += '</div>';
        return html;
    },

    setupIconSelection() {
        const iconInput = document.getElementById('shortcut-icon');
        const options = document.querySelectorAll('#modal-body .icon-option');
        options.forEach(opt => {
            opt.onmouseenter = () => { if (!opt.classList.contains('selected')) opt.style.background = 'var(--border-color)'; };
            opt.onmouseleave = () => { if (!opt.classList.contains('selected')) opt.style.background = 'transparent'; };
            opt.onclick = () => {
                options.forEach(o => {
                    o.classList.remove('selected');
                    o.style.border = '2px solid transparent';
                    o.style.background = 'transparent';
                });
                opt.classList.add('selected');
                opt.style.border = '2px solid var(--accent-color)';
                opt.style.background = 'rgba(88,166,255,0.1)';
                iconInput.value = opt.dataset.icon;
            };
        });
    },

    async addShortcut() {
        const bodyHtml = `
            <div style="display: flex; flex-direction: column; gap: 10px;">
                <input type="text" id="shortcut-title" placeholder="Name">
                <input type="text" id="shortcut-url" placeholder="URL (http/https or C:/...)">
                <input type="hidden" id="shortcut-icon" value="🌐">
                ${this.getIconSelectionHTML('🌐')}
            </div>
        `;
        Modals.show('Add Shortcut', bodyHtml, async () => {
            const title = document.getElementById('shortcut-title').value.trim();
            const url = document.getElementById('shortcut-url').value.trim();
            const icon = document.getElementById('shortcut-icon').value.trim() || '🌐';
            
            if (!title || !url) return;

            const shortcuts = await API.getShortcuts();
            shortcuts.push({ id: Date.now().toString(), title, url, icon });
            await API.saveShortcuts(shortcuts);
            await this.loadShortcuts();
        });
        this.setupIconSelection();
    },

    async editShortcut(id) {
        const shortcuts = await API.getShortcuts();
        const shortcut = shortcuts.find(s => s.id === id);
        if (!shortcut) return;

        const bodyHtml = `
            <div style="display: flex; flex-direction: column; gap: 10px;">
                <input type="text" id="shortcut-title" value="${shortcut.title.replace(/"/g, '&quot;')}">
                <input type="text" id="shortcut-url" value="${shortcut.url.replace(/"/g, '&quot;')}">
                <input type="hidden" id="shortcut-icon" value="${shortcut.icon.replace(/"/g, '&quot;')}">
                ${this.getIconSelectionHTML(shortcut.icon)}
            </div>
        `;
        Modals.show('Edit Shortcut', bodyHtml, async () => {
            shortcut.title = document.getElementById('shortcut-title').value.trim();
            shortcut.url = document.getElementById('shortcut-url').value.trim();
            shortcut.icon = document.getElementById('shortcut-icon').value.trim() || '🌐';
            
            if (!shortcut.title || !shortcut.url) return;
            await API.saveShortcuts(shortcuts);
            await this.loadShortcuts();
        });
        this.setupIconSelection();
    },

    async deleteShortcut(id) {
        Modals.showConfirm('Delete Shortcut', 'Are you sure you want to delete this shortcut?', async () => {
            let shortcuts = await API.getShortcuts();
            shortcuts = shortcuts.filter(s => s.id !== id);
            await API.saveShortcuts(shortcuts);
            await this.loadShortcuts();
        }, 'danger');
    },

    showDashboard() {
        document.getElementById('welcome-view').style.display = 'flex';
        document.getElementById('editor-view').style.display = 'none';
        Tree.deselect();
    },

    hideDashboard() {
        document.getElementById('welcome-view').style.display = 'none';
        document.getElementById('editor-view').style.display = 'flex';
    },

    initResizer() {
        const sidebar = document.querySelector('.sidebar');
        const resizer = document.getElementById('resizer');
        const appContainer = document.querySelector('.app-container');

        // Load saved width
        const savedWidth = localStorage.getItem('sidebarWidth');
        if (savedWidth) {
            sidebar.style.width = savedWidth + 'px';
        }

        let isResizing = false;

        resizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            document.body.classList.add('resizing-active');
            resizer.classList.add('active');
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;

            let newWidth = e.clientX;

            // Constrain width
            if (newWidth < 200) newWidth = 200;
            if (newWidth > 600) newWidth = 600;

            sidebar.style.width = newWidth + 'px';
            localStorage.setItem('sidebarWidth', newWidth);
        });

        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                document.body.classList.remove('resizing-active');
                resizer.classList.remove('active');
            }
        });
    },

    addEventListeners() {
        const homeBtn = document.getElementById('home-btn');
        if (homeBtn) homeBtn.onclick = () => this.showDashboard();
        
        const welcomeAddBtn = document.getElementById('welcome-add-btn');
        if (welcomeAddBtn) welcomeAddBtn.onclick = () => this.addNew();
        
        const welcomeExportShortcutsBtn = document.getElementById('welcome-export-shortcuts-btn');
        if (welcomeExportShortcutsBtn) welcomeExportShortcutsBtn.onclick = () => this.exportShortcuts();
        
        const welcomeImportShortcutsBtn = document.getElementById('welcome-import-shortcuts-btn');
        if (welcomeImportShortcutsBtn) welcomeImportShortcutsBtn.onclick = () => this.importShortcuts();

        document.getElementById('lang-toggle-btn').onclick = () => I18n.toggle();
        document.getElementById('add-doc-btn').onclick = () => this.addNew();

        // Search with debounce
        const searchInput = document.getElementById('search-input');
        const searchClear = document.getElementById('search-clear');
        let searchTimeout;

        const updateClearVisibility = () => {
            searchClear.style.display = searchInput.value ? 'block' : 'none';
        };

        searchInput.oninput = () => {
            updateClearVisibility();
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => this.handleSearch(searchInput.value), 300);
        };

        searchClear.onclick = () => {
            searchInput.value = '';
            updateClearVisibility();
            this.handleSearch('');
            searchInput.focus();
        };

        // Auto-save on blur
        Editor.titleInput.onblur = () => Editor.save();
        Editor.contentArea.onblur = () => Editor.save();

        // Export/Import stubs for now
        document.getElementById('export-doc-btn').onclick = () => this.exportCurrent();
        document.getElementById('export-all-btn').onclick = () => this.exportAll();
        document.getElementById('backup-db-btn').onclick = () => this.backupDb();
        document.getElementById('import-db-btn').onclick = () => this.importDb();

        const resetBtn = document.getElementById('reset-btn');
        if (resetBtn) {
            resetBtn.onclick = () => {
                Modals.show(
                    I18n.get('confirm_reset_title'),
                    I18n.get('confirm_reset_text'),
                    async () => {
                        await API.deleteAllDocuments();
                        Editor.clear();
                        await Tree.refresh();
                    },
                    'danger'
                );
            };
        }
    },

    async addNew(parentId = null) {
        try {
            const newItem = await API.createDocument({
                title: I18n.get('new_doc_title'),
                is_folder: 0,
                parent_id: parentId
            });
            await Tree.refresh();
            await Tree.selectItem(newItem);
            this.hideDashboard();

            // Focus title and select text for quick renaming
            Editor.titleInput.focus();
            Editor.titleInput.select();
        } catch (err) {
            console.error('Failed to create document:', err);
        }
    },

    async exportCurrent() {
        if (!Editor.currentDoc) {
            Modals.showInfo(I18n.get('notice_title'), I18n.get('select_first'));
            return;
        }
        if (!this.turndown) {
            Modals.showInfo(I18n.get('error_title'), I18n.get('converter_error'));
            return;
        }
        // Pre-process HTML: normalize div structure for proper line breaks
        // Editor wraps each line in <div>, TurndownService treats <div> as paragraph (double newline)
        let html = Editor.contentArea.innerHTML;
        // Replace empty divs (blank line indicators in editor) with <br><br> (paragraph break)
        html = html.replace(/<div>\s*(?:<br\s*\/?>)?\s*<\/div>/gi, '<br><br>');
        // Replace </div><div> boundaries between content divs with <br> (line break)
        html = html.replace(/<\/div>\s*<div(?:\s[^>]*)?>/gi, '<br>');
        // Strip remaining opening/closing div tags
        html = html.replace(/<\/?div(?:\s[^>]*)?>/gi, '');

        let md = this.turndown.turndown(html);

        // Post-processing: clean up extra whitespace
        // Remove lines that are just ** or __ (empty bold/italic artifacts)
        md = md.replace(/^\s*(\*\*|__)\s*$/gm, '');
        // Clean whitespace-only lines (from <div><br></div> etc.)
        md = md.replace(/^\s+$/gm, '');
        // Collapse 3+ consecutive newlines into 2 (max one blank line)
        md = md.replace(/\n{3,}/g, '\n\n');
        // Unescape markdown special chars that TurndownService over-escapes
        md = md.replace(/^\\-/gm, '-');
        md = md.replace(/^(\s*)\\(\d+)\./gm, '$1$2.');
        // Unescape \. after digits anywhere (e.g. "1\." → "1.")
        md = md.replace(/(\d)\\\./g, '$1.');
        // Unescape underscores (e.g. "name\_suffix" → "name_suffix")
        md = md.replace(/\\_/g, '_');
        // Trim leading/trailing whitespace
        md = md.trim();

        const fileName = `${Editor.currentDoc.title}.md`;
        this.downloadFile(fileName, md);
    },

    async exportAll() {
      try {
        const md = await API.exportAllMarkdown();
        this.downloadFile('notebook_export.md', md);
      } catch (err) {
        console.error('Export All failed:', err);
        Modals.showInfo(I18n.get('error_title'), I18n.get('export_all_error'));
      }
    },

    async refreshStats() {

        const count = await API.getDocCount();
        const el = document.getElementById('doc-count');
        if (el) el.textContent = count;
    },

    async handleSearch(query) {
        const treeContainer = document.getElementById('tree-container');
        const allItems = treeContainer.querySelectorAll('li[data-id]');

        // If query is empty, show all
        // If query is empty, show all and clear highlights
        if (query.length < 1) {
            allItems.forEach(li => {
                li.style.display = '';
                li.classList.remove('search-match');
                const titleSpan = li.querySelector('.tree-title');
                if (titleSpan && titleSpan.dataset.original) {
                    titleSpan.textContent = titleSpan.dataset.original;
                    delete titleSpan.dataset.original;
                }
            });
            Editor.applyHighlight('');
            return;
        }

        // Get matching IDs from server
        const result = await API.search(query);
        const visibleIds = new Set([...result.matches, ...result.ancestors]);

        // Highlight pattern in editor if document is open
        Editor.applyHighlight(query);

        // Filter tree and highlight pattern
        allItems.forEach(li => {
            const id = parseInt(li.dataset.id);
            const titleSpan = li.querySelector('.tree-title');

            // Revert to original title first
            if (titleSpan.dataset.original) {
                titleSpan.textContent = titleSpan.dataset.original;
            }

            if (visibleIds.has(id)) {
                li.style.display = '';
                const isMatch = result.matches.includes(id);
                li.classList.toggle('search-match', isMatch);

                if (isMatch) {
                    // Save original if not saved
                    if (!titleSpan.dataset.original) {
                        titleSpan.dataset.original = titleSpan.textContent;
                    }
                    // Highlight pattern
                    const text = titleSpan.dataset.original;
                    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const regex = new RegExp(`(${escaped})`, 'gi');
                    titleSpan.innerHTML = text.replace(regex, '<mark>$1</mark>');
                }
            } else {
                li.style.display = 'none';
                li.classList.remove('search-match');
            }
        });
    },



    downloadFile(filename, text) {
        const mimeType = filename.endsWith('.md') ? 'text/markdown' : 'text/html';
        const blob = new Blob([text], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const element = document.createElement('a');
        element.href = url;
        element.download = filename;
        element.style.display = 'none';
        document.body.appendChild(element);
        element.click();
        setTimeout(() => {
            document.body.removeChild(element);
            URL.revokeObjectURL(url);
        }, 100);
    },

    async backupDb() {
      try {
        const data = await API.backupData();
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
  
        if ('showSaveFilePicker' in window) {
          try {
            const handle = await window.showSaveFilePicker({
              suggestedName: 'notebook.backup.json',
              types: [{
                description: 'Notebook Backup',
                accept: { 'application/json': ['.json'] }
              }]
            });
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
          } catch (err) {
            if (err.name !== 'AbortError') {
              console.error('Backup failed:', err);
              // Fallback: download via blob URL
              this.downloadFile('notebook.backup.json', json);
            }
          }
        } else {
          this.downloadFile('notebook.backup.json', json);
        }
      } catch (err) {
        console.error('Backup failed:', err);
        Modals.showInfo(I18n.get('error_title'), err.message || 'Backup failed');
      }
    },
  
    async importDb() {
      Modals.showConfirm(
        I18n.get('confirm_import_title'),
        I18n.get('confirm_import_text'),
        async () => {
          try {
            let file;
            if ('showOpenFilePicker' in window) {
              const [handle] = await window.showOpenFilePicker({
                types: [{
                  description: 'Notebook Backup',
                  accept: { 'application/json': ['.json'] }
                }],
                multiple: false
              });
              file = await handle.getFile();
            } else {
              // Fallback for browsers without showOpenFilePicker
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = '.json';
              file = await new Promise((resolve) => {
                input.onchange = () => resolve(input.files[0]);
                input.click();
              });
            }
  
            if (!file) return;
  
            // Read and parse JSON file
            const text = await file.text();
            let data;
            try {
              data = JSON.parse(text);
            } catch (e) {
              alert('Import failed: invalid JSON file');
              return;
            }
  
            // Import data into chrome.storage
            await API.importData(data);
  
            // Reload the UI
            await Tree.refresh();
            Editor.clear();
            Main.refreshStats();
          } catch (err) {
            if (err.name !== 'AbortError') {
              console.error('Import failed:', err);
              alert('Import failed: ' + err.message);
            }
          }
        },
        'danger'
      );
    },
  
    async exportShortcuts() {
      try {
        const data = await API.backupShortcuts();
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
  
        if ('showSaveFilePicker' in window) {
          try {
            const handle = await window.showSaveFilePicker({
              suggestedName: 'notebook.home.json',
              types: [{
                description: 'Shortcuts Backup',
                accept: { 'application/json': ['.json'] }
              }]
            });
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
          } catch (err) {
            if (err.name !== 'AbortError') {
              console.error('Backup failed:', err);
              this.downloadFile('notebook.home.json', json);
            }
          }
        } else {
          this.downloadFile('notebook.home.json', json);
        }
      } catch (err) {
        console.error('Backup failed:', err);
        Modals.showInfo(I18n.get('error_title'), err.message || 'Export failed');
      }
    },
  
    async importShortcuts() {
      try {
        let file;
        if ('showOpenFilePicker' in window) {
          const [handle] = await window.showOpenFilePicker({
            types: [{
              description: 'Shortcuts Backup',
              accept: { 'application/json': ['.json'] }
            }],
            multiple: false
          });
          file = await handle.getFile();
        } else {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = '.json';
          file = await new Promise((resolve) => {
            input.onchange = () => resolve(input.files[0]);
            input.click();
          });
        }
  
        if (!file) return;
  
        const text = await file.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch (e) {
          alert('Import failed: invalid JSON file');
          return;
        }
  
        if (data.type !== 'shortcuts') {
          alert('Import failed: Not a valid shortcuts file.');
          return;
        }
  
        await API.importShortcuts(data);
        await this.loadShortcuts();
        Modals.showInfo(I18n.get('notice_title') || 'Notice', 'Shortcuts imported successfully');
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error('Import failed:', err);
          alert('Import failed: ' + err.message);
        }
      }
    }
};

window.onload = () => Main.init();
