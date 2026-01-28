const Tree = {
    container: document.getElementById('tree-container'),
    selectedId: null,

    async refresh() {
        const treeData = await API.getTree();
        this.render(treeData);
        Main.refreshStats();

        // Re-apply search if search input has value
        const searchInput = document.getElementById('search-input');
        if (searchInput && searchInput.value) {
            Main.handleSearch(searchInput.value);
        }

        // Add container click for deselection
        this.container.onclick = (e) => {
            if (e.target === this.container) {
                this.deselect();
            }
        };
    },

    deselect() {
        this.selectedId = null;
        Editor.clear();
        this.refresh();
    },

    render(data) {
        this.container.innerHTML = '';
        if (!Array.isArray(data)) {
            console.error('Tree data is not an array:', data);
            return;
        }
        const list = this.createList(data);
        this.container.appendChild(list);
    },

    createList(data, isRoot = true) {
        const ul = document.createElement('ul');
        ul.className = isRoot ? 'tree-list' : 'tree-list tree-children';
        data.forEach(item => {
            const li = this.createItem(item);
            ul.appendChild(li);
        });
        return ul;
    },

    createItem(item) {
        const li = document.createElement('li');
        li.className = 'tree-item';
        li.dataset.id = item.id;

        const row = document.createElement('div');
        row.className = `tree-row ${this.selectedId === item.id ? 'selected' : ''}`;
        row.dataset.id = item.id;

        const icon = document.createElement('span');
        icon.className = 'tree-icon';
        icon.textContent = '📄';

        const title = document.createElement('span');
        title.className = 'tree-title';
        title.textContent = item.title;
        title.ondblclick = (e) => {
            e.stopPropagation();
            this.renameItem(item);
        };

        const actions = document.createElement('div');
        actions.className = 'tree-actions';

        const addBtn = document.createElement('button');
        addBtn.className = 'tree-action-btn';
        addBtn.textContent = '➕';
        addBtn.title = 'Add Sub-document';
        addBtn.onclick = (e) => {
            e.stopPropagation();
            Main.addNew(item.id);
        };


        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'tree-action-btn';
        deleteBtn.textContent = '🗑️';
        deleteBtn.title = 'Delete';
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            this.deleteItem(item);
        };

        actions.appendChild(addBtn);
        actions.appendChild(deleteBtn);

        row.appendChild(icon);
        row.appendChild(title);
        row.appendChild(actions);
        li.appendChild(row);

        row.onmousedown = (e) => {
            // If click is on an action button, don't select the item
            if (e.target.closest('.tree-actions')) {
                return;
            }
            e.stopPropagation();

            if (e.detail === 2) {
                this.renameItem(item);
            } else {
                Editor.save();
                this.selectItem(item);
            }
        };

        // --- Drag & Drop ---
        li.draggable = true;
        li.ondragstart = (e) => {
            e.stopPropagation();
            this.draggedId = item.id;
            li.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', item.id);
        };

        li.ondragend = (e) => {
            li.classList.remove('dragging');
            this.draggedId = null;
        };

        row.ondragover = (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (this.draggedId === item.id) return;

            const rect = row.getBoundingClientRect();
            const y = e.clientY - rect.top;
            const height = rect.height;

            // Remove previous indicators
            row.classList.remove('drag-over-inside', 'drag-over-top', 'drag-over-bottom');

            if (y < height * 0.25) {
                row.classList.add('drag-over-top');
            } else if (y > height * 0.75) {
                row.classList.add('drag-over-bottom');
            } else {
                row.classList.add('drag-over-inside');
            }
        };

        row.ondragleave = (e) => {
            row.classList.remove('drag-over-inside', 'drag-over-top', 'drag-over-bottom');
        };

        row.ondrop = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const draggedId = parseInt(this.draggedId);
            if (draggedId === item.id) return;

            const rect = row.getBoundingClientRect();
            const y = e.clientY - rect.top;
            const height = rect.height;

            row.classList.remove('drag-over-inside', 'drag-over-top', 'drag-over-bottom');

            if (y < height * 0.25) {
                await this.moveDocument(draggedId, item.id, 'before');
            } else if (y > height * 0.75) {
                await this.moveDocument(draggedId, item.id, 'after');
            } else {
                await this.moveDocument(draggedId, item.id, 'inside');
            }
        };

        if (item.children && item.children.length > 0) {
            const childrenList = this.createList(item.children, false);
            li.appendChild(childrenList);
        }

        return li;
    },

    async selectItem(item) {
        // Update selected state in DOM without full refresh
        const oldSelected = this.container.querySelector('.tree-row.selected');
        if (oldSelected) {
            oldSelected.classList.remove('selected');
        }

        const newSelected = this.container.querySelector(`.tree-row[data-id="${item.id}"]`);
        if (newSelected) {
            newSelected.classList.add('selected');
        }

        this.selectedId = item.id;

        const fullDoc = await API.getDocument(item.id);
        Editor.load(fullDoc);
    },

    async deleteItem(item) {
        Modals.show('Delete Document', `<p>Delete "${item.title}" and all its sub-documents?</p>`, async () => {
            await API.deleteDocument(item.id);
            if (Editor.currentDoc && Editor.currentDoc.id === item.id) {
                Editor.clear();
            }
            await this.refresh();
        }, 'danger');
    },

    async renameItem(item) {
        const titleSpan = document.querySelector(`li[data-id="${item.id}"] .tree-title`);
        if (!titleSpan) return;

        const originalTitle = item.title;

        const input = document.createElement('input');
        input.type = 'text';
        input.value = originalTitle;
        input.className = 'tree-rename-input';

        titleSpan.innerHTML = '';
        titleSpan.appendChild(input);
        input.focus();
        input.select();

        let finished = false;
        const finishRename = async (save) => {
            if (finished) return;
            finished = true;

            const newTitle = input.value.trim();
            if (save && newTitle && newTitle !== originalTitle) {
                try {
                    await API.updateDocument(item.id, { title: newTitle });
                    // Refresh will update the tree and the editor title if needed
                    await this.refresh();
                    if (Editor.currentDoc && Editor.currentDoc.id === item.id) {
                        Editor.titleInput.value = newTitle;
                    }
                } catch (err) {
                    console.error('Rename failed:', err);
                    titleSpan.textContent = originalTitle;
                }
            } else {
                titleSpan.textContent = originalTitle;
            }
        };

        input.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.stopPropagation();
                finishRename(true);
            }
            if (e.key === 'Escape') {
                e.stopPropagation();
                finishRename(false);
            }
        };
        input.onblur = () => finishRename(true);
        input.onmousedown = (e) => e.stopPropagation(); // Prevent row click
    },

    async moveDocument(draggedId, targetId, type) {
        // 1. Basic circular check (dropping on self is handled in row.ondrop)

        // 2. Fetch full tree data to check for deep circular dependency
        const treeData = await API.getTree();

        const isDescendant = (nodes, parentId, childId) => {
            for (const node of nodes) {
                if (node.id === parentId) {
                    return this.containsId(node.children, childId);
                }
                const found = isDescendant(node.children, parentId, childId);
                if (found) return true;
            }
            return false;
        };

        if (this.isDescendantOf(treeData, draggedId, targetId)) {
            Modals.showInfo('Error', 'Cannot move a document into its own sub-document.');
            return;
        }

        // 3. Get target document details
        const allDocs = this.flattenTree(treeData);
        const targetDoc = allDocs.find(d => d.id === targetId);
        if (!targetDoc) return;

        let newParentId = null;
        let newPosition = 0;

        if (type === 'inside') {
            newParentId = targetId;
            newPosition = 0; // Top of the list
        } else {
            newParentId = targetDoc.parent_id;
            newPosition = type === 'before' ? targetDoc.position : targetDoc.position + 1;
        }

        try {
            await API.updateDocument(draggedId, {
                parent_id: newParentId,
                position: newPosition
            });
            await this.refresh();
        } catch (err) {
            console.error('Move failed:', err);
            Modals.showInfo('Error', 'Failed to move document');
        }
    },

    // Helper: check if targetId is inside the subtree of parentId
    isDescendantOf(nodes, parentId, targetId) {
        for (const node of nodes) {
            if (node.id === parentId) {
                return this.containsId(node.children, targetId);
            }
            if (this.isDescendantOf(node.children, parentId, targetId)) return true;
        }
        return false;
    },

    containsId(nodes, targetId) {
        for (const node of nodes) {
            if (node.id === targetId) return true;
            if (this.containsId(node.children, targetId)) return true;
        }
        return false;
    },

    flattenTree(nodes) {
        let result = [];
        for (const node of nodes) {
            result.push({ id: node.id, parent_id: node.parent_id, position: node.position });
            if (node.children) {
                result = result.concat(this.flattenTree(node.children));
            }
        }
        return result;
    }
};
