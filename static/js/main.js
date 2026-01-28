const Main = {
    async init() {
        try {
            await Tree.refresh();
        } catch (err) {
            console.error('Failed to load tree:', err);
        }

        // Add event listeners
        this.addEventListeners();
        this.refreshStats();
    },

    addEventListeners() {
        document.getElementById('add-doc-btn').onclick = () => this.addNew();

        // Search with debounce
        const searchInput = document.getElementById('search-input');
        let searchTimeout;
        searchInput.oninput = () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => this.handleSearch(searchInput.value), 300);
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

    addNew() {
        const bodyHtml = `<input type="text" id="new-item-title" placeholder="Title..." value="New Document">`;

        Modals.show(`Create Document`, bodyHtml, async () => {
            const newTitle = document.getElementById('new-item-title').value;
            const parentId = Tree.selectedId;

            const newItem = await API.createDocument({
                title: newTitle,
                is_folder: 0,
                parent_id: parentId
            });
            await Tree.refresh();
            Tree.selectItem(newItem);
        });
    },

    async exportCurrent() {
        if (!Editor.currentDoc) return;
        const htmlContent = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>${Editor.currentDoc.title}</title>
</head>
<body>
    <h1>${Editor.currentDoc.title}</h1>
    ${Editor.contentArea.innerHTML}
</body>
</html>`;
        this.downloadFile(`${Editor.currentDoc.title}.html`, htmlContent);
    },

    async exportAll() {
        window.location.href = '/api/export/all';
    },

    showImport() {
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
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(text, 'text/html');

                    const parentId = Tree.selectedId;
                    const documentDivs = doc.querySelectorAll('.document');
                    console.log(`[Import] Found ${documentDivs.length} document containers`);

                    const idMap = {}; // originalId -> newId
                    const itemsToUpdate = []; // [{ newId, originalParentId }]

                    if (documentDivs.length > 0) {
                        for (const div of documentDivs) {
                            const originalId = div.dataset.id;
                            const originalParentId = div.dataset.parentId; // undefined for root docs
                            const titleEl = div.querySelector('h1');
                            const title = titleEl ? titleEl.textContent.trim() : 'Untitled';

                            let content = "";
                            // Find content div - skip .tree-indicator and .children
                            const allDivs = div.querySelectorAll(':scope > div');
                            for (const d of allDivs) {
                                if (!d.classList.contains('tree-indicator') && !d.classList.contains('children')) {
                                    content = d.innerHTML;
                                    break;
                                }
                            }

                            // Root documents (no originalParentId) -> parent_id: null
                            // Child documents -> will be re-parented in Pass 2
                            const initialParentId = originalParentId ? null : null; // All start at root

                            console.log(`[Import] Creating: ${title}, originalParent: ${originalParentId || 'ROOT'}`);
                            const newItem = await API.createDocument({
                                title: title,
                                content: content,
                                is_folder: 0,
                                parent_id: initialParentId
                            });

                            idMap[originalId] = newItem.id;
                            if (originalParentId) {
                                itemsToUpdate.push({
                                    newId: newItem.id,
                                    originalParentId: originalParentId
                                });
                            }
                        }

                        // Pass 2: Re-parent documents that have internal parents
                        console.log(`[Import] Re - parenting ${itemsToUpdate.length} documents...`);
                        for (const task of itemsToUpdate) {
                            const newParentId = idMap[task.originalParentId];
                            if (newParentId) {
                                await API.updateDocument(task.newId, {
                                    parent_id: newParentId
                                });
                            }
                        }
                    } else {
                        // Single document mode (no .document metadata)
                        // Prefer h1 for title, then <title> tag, then filename
                        const h1El = doc.querySelector('h1');
                        const titleEl = doc.querySelector('title');
                        const title = h1El?.textContent?.trim() ||
                            titleEl?.textContent?.trim() ||
                            file.name.replace('.html', '');

                        // Clone body and remove h1 if we used it for title
                        const bodyClone = doc.body.cloneNode(true);
                        if (h1El) {
                            const h1InClone = bodyClone.querySelector('h1');
                            if (h1InClone) h1InClone.remove();
                        }
                        const content = bodyClone.innerHTML;

                        await API.createDocument({
                            title: title,
                            content: content,
                            is_folder: 0,
                            parent_id: parentId
                        });
                    }

                    await Tree.refresh();
                    const count = documentDivs.length || 1;
                    alert(`Successfully imported ${count} document(s).`);
                } catch (err) {
                    console.error('Import failed:', err);
                    alert('Failed to import documents');
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
        if (query.length < 1) {
            allItems.forEach(li => {
                li.style.display = '';
                li.classList.remove('search-match');
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
                    alert('Import successful!');
                } catch (err) {
                    console.error('Import failed:', err);
                    alert('Import failed: ' + err.message);
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
        const element = document.createElement('a');
        element.setAttribute('href', 'data:text/html;charset=utf-8,' + encodeURIComponent(text));
        element.setAttribute('download', filename);
        element.style.display = 'none';
        document.body.appendChild(element);
        element.click();
        document.body.removeChild(element);
    }
};

window.onload = () => Main.init();
