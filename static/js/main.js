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
            } else {
                console.warn('TurndownService not found, Markdown export will be limited.');
            }
        } catch (e) {
            console.error('Failed to init Turndown:', e);
        }

        try {
            await Tree.refresh();
        } catch (err) {
            console.error('Failed to load tree:', err);
        }

        // Add event listeners
        this.addEventListeners();
        this.refreshStats();

        // Auto-save every 5 minutes
        setInterval(() => {
            console.log('[Auto-save] Periodic trigger');
            Editor.save();
        }, 5 * 60 * 1000);
    },

    addEventListeners() {
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
        document.getElementById('import-btn').onclick = () => this.showImport();
        document.getElementById('import-cherry-btn').onclick = () => this.showImportCherryTree();

        const resetBtn = document.getElementById('reset-btn');
        if (resetBtn) {
            resetBtn.onclick = () => {
                Modals.show(
                    'Reset Notebook',
                    '<p>Are you sure you want to delete ALL documents? This action cannot be undone.</p>',
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
                title: "New Document",
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
            Modals.showInfo('Notice', 'Please select a document first.');
            return;
        }
        if (!this.turndown) {
            Modals.showInfo('Error', 'Markdown converter not loaded. Please check your connection.');
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
            Modals.showInfo('Error', 'Failed to export all documents');
        }
    },

    showImport() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.html,.md';

        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = async (event) => {
                try {
                    const text = event.target.result;
                    const parentId = Tree.selectedId;

                    // 1. Detect Bulk Format (Regardless of extension)
                    const isMDBulk = text.includes('notebook-bulk-export') || text.includes('notebook-metadata:');
                    const isHTMLBulk = text.includes('class="document"') || text.includes("class='document'");

                    if (isMDBulk) {
                        console.log('[Import] Detected bulk MD format');
                        const docs = text.split(/<!-- notebook-doc-separator -->/).filter(part => part.trim());
                        const idMap = {};
                        const itemsToUpdate = [];

                        for (const docStr of docs) {
                            const metadataMatch = docStr.match(/<!-- notebook-metadata: ({.*?}) -->/);
                            if (!metadataMatch) continue;

                            try {
                                const metadata = JSON.parse(metadataMatch[1]);

                                // Extract title: look for the LAST heading BEFORE the metadata in this block
                                const headPart = docStr.substring(0, docStr.indexOf(metadataMatch[0]));
                                const titleLines = headPart.split('\n').filter(line => line.trim().startsWith('#'));

                                let title = metadata.title;
                                if (titleLines.length > 0) {
                                    const lastTitleLine = titleLines[titleLines.length - 1];
                                    title = lastTitleLine.replace(/^#+\s*/, '').trim();
                                }

                                // Extract content: everything after THIS metadata block
                                const contentStart = docStr.indexOf(metadataMatch[0]) + metadataMatch[0].length;
                                let rawContent = docStr.substring(contentStart).trim();

                                // Pre-process: convert whitespace-only lines to visible breaks
                                // Lines with only spaces (like "  ") become <br> for visual spacing
                                let processedContent = rawContent
                                    .split('\n')
                                    .map(line => line.trim() === '' ? '<br>' : line)
                                    .join('\n');

                                const htmlContent = marked.parse(processedContent);

                                const newItem = await API.createDocument({
                                    title: title,
                                    content: htmlContent,
                                    is_folder: 0,
                                    parent_id: null
                                });
                                idMap[metadata.id] = newItem.id;
                                if (metadata.parent_id) {
                                    itemsToUpdate.push({ newId: newItem.id, originalParentId: metadata.parent_id });
                                }
                            } catch (e) {
                                console.error('[Import] Failed to parse MD block', e);
                            }
                        }
                        for (const task of itemsToUpdate) {
                            const newParentId = idMap[task.originalParentId];
                            if (newParentId) await API.updateDocument(task.newId, { parent_id: newParentId });
                        }
                        Modals.showInfo('Import Successful', `Successfully imported ${Object.keys(idMap).length} documents from MD archive.`);

                    } else if (isHTMLBulk) {
                        console.log('[Import] Detected bulk HTML format');
                        const parser = new DOMParser();
                        const doc = parser.parseFromString(text, 'text/html');
                        const documentDivs = doc.querySelectorAll('.document');
                        const idMap = {};
                        const itemsToUpdate = [];

                        for (const div of documentDivs) {
                            const originalId = div.dataset.id;
                            const originalParentId = div.dataset.parentId;
                            const title = div.querySelector('h1')?.textContent.trim() || 'Untitled';
                            let content = "";
                            const allDivs = div.querySelectorAll(':scope > div');
                            for (const d of allDivs) {
                                if (!d.classList.contains('tree-indicator') && !d.classList.contains('children')) {
                                    content = d.innerHTML;
                                }
                            }
                            const newItem = await API.createDocument({ title, content, parent_id: null });
                            idMap[originalId] = newItem.id;
                            if (originalParentId) itemsToUpdate.push({ newId: newItem.id, originalParentId });
                        }
                        for (const task of itemsToUpdate) {
                            const newParentId = idMap[task.originalParentId];
                            if (newParentId) await API.updateDocument(task.newId, { parent_id: newParentId });
                        }
                        Modals.showInfo('Import Successful', `Successfully imported ${documentDivs.length} documents from HTML archive.`);

                    } else {
                        // 2. Single Document Import
                        let title = file.name.replace(/\.(html|md)$/, '');
                        let content = "";

                        if (file.name.endsWith('.md')) {
                            // Pre-process: convert whitespace-only lines to visible breaks
                            let processedContent = text
                                .split('\n')
                                .map(line => line.trim() === '' ? '<br>' : line)
                                .join('\n');
                            content = marked.parse(processedContent);
                            const titleMatch = text.match(/^# (.*)$/m);
                            if (titleMatch) title = titleMatch[1].trim();
                        } else {
                            const parser = new DOMParser();
                            const doc = parser.parseFromString(text, 'text/html');
                            const h1 = doc.querySelector('h1');
                            if (h1) {
                                title = h1.textContent.trim();
                                h1.remove();
                            }
                            content = doc.body ? doc.body.innerHTML : text;
                        }

                        await API.createDocument({
                            title: title,
                            content: content,
                            is_folder: 0,
                            parent_id: parentId
                        });
                        Modals.showInfo('Import Successful', 'Successfully imported single document.');
                    }

                    await Tree.refresh();
                } catch (err) {
                    console.error('Import failed:', err);
                    Modals.showInfo('Import Failed', 'Failed to import documents');
                }
            };
            reader.readAsText(file);
        };
        input.click();
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

    showImportCherryTree() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.html';

        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = async (event) => {
                try {
                    const text = event.target.result;
                    await this.importCherryTree(text);
                    await Tree.refresh();
                    Modals.showInfo('Import Successful', 'Import successful!');
                } catch (err) {
                    console.error('Import failed:', err);
                    Modals.showInfo('Import Failed', 'Import failed: ' + err.message);
                }
            };
            reader.readAsText(file);
        };
        input.click();
    },

    async importCherryTree(htmlContent) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlContent, 'text/html');
        // CherryTree export uses div.page for each node
        const pages = doc.querySelectorAll('div.page');

        // Stack to keep track of parent IDs for levels
        // index corresponds to level. level 1 -> index 1 (parent is null)
        const parentStack = {};

        for (const page of pages) {
            // Find h1 with class 'title level-X'
            const h1 = page.querySelector('h1.title');
            if (!h1) continue;

            const title = h1.textContent.trim();

            // Extract level from class "level-1", "level-2", etc.
            let level = 1;
            const levelClass = Array.from(h1.classList).find(cls => cls.startsWith('level-'));
            if (levelClass) {
                level = parseInt(levelClass.split('-')[1]);
            }

            // Extract content: everything in the div after the h1
            // Use a temporary div to gather content nodes
            const contentDiv = document.createElement('div');
            let sibling = h1.nextSibling;
            while (sibling) {
                contentDiv.appendChild(sibling.cloneNode(true));
                sibling = sibling.nextSibling;
            }
            const content = contentDiv.innerHTML;

            // Determine parent_id
            // Level 1 has no parent (null). Level 2 uses parentStack[1], etc.
            const parentId = level > 1 ? parentStack[level - 1] : null;

            try {
                const newItem = await API.createDocument({
                    title: title,
                    content: content,
                    is_folder: 0,
                    parent_id: parentId
                });

                // Store current ID for children (next level)
                parentStack[level] = newItem.id;
                console.log(`[CherryTree] Imported: ${title} (Level ${level}) -> ID: ${newItem.id}, Parent: ${parentId}`);

            } catch (err) {
                console.error(`[CherryTree] Failed to import: ${title}`, err);
            }
        }
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
    }
};

window.onload = () => Main.init();
