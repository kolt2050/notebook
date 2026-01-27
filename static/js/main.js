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
            return;
        }

        // Get matching IDs from server
        const result = await API.search(query);
        console.log('[Search] Query:', query, 'Result:', result);
        const visibleIds = new Set([...result.matches, ...result.ancestors]);

        // Filter tree
        allItems.forEach(li => {
            const id = parseInt(li.dataset.id);
            if (visibleIds.has(id)) {
                li.style.display = '';
                li.classList.toggle('search-match', result.matches.includes(id));
            } else {
                li.style.display = 'none';
                li.classList.remove('search-match');
            }
        });
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
