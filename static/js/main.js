const Main = {
    async init() {
        try {
            if (typeof TurndownService !== 'undefined') {
                this.turndown = new TurndownService({
                    headingStyle: 'atx',
                    codeBlockStyle: 'fenced'
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
        const md = this.turndown.turndown(Editor.contentArea.innerHTML);
        const fileName = `${Editor.currentDoc.title}.md`;
        this.downloadFile(fileName, md);
    },

    async exportAll() {
        try {
            const response = await fetch('/api/export/all');
            if (!response.ok) throw new Error('Export failed');
            const md = await response.text();
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
        if ('showSaveFilePicker' in window) {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: 'notebook.backup.db',
                    types: [{
                        description: 'SQLite Database',
                        accept: { 'application/x-sqlite3': ['.db'] }
                    }]
                });

                const response = await fetch('/api/backup/db');
                const blob = await response.blob();

                const writable = await handle.createWritable();
                await writable.write(blob);
                await writable.close();
            } catch (err) {
                if (err.name !== 'AbortError') {
                    console.error('Backup failed:', err);
                    window.open('/api/backup/db', '_blank');
                }
            }
        } else {
            window.open('/api/backup/db', '_blank');
        }
    }
};

window.onload = () => Main.init();
