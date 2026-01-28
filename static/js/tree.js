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

        const actions = document.createElement('div');
        actions.className = 'tree-actions';

        const renameBtn = document.createElement('button');
        renameBtn.className = 'tree-action-btn';
        renameBtn.textContent = '✏️';
        renameBtn.title = 'Rename';
        renameBtn.onclick = (e) => {
            e.stopPropagation();
            this.renameItem(item);
        };

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'tree-action-btn';
        deleteBtn.textContent = '🗑️';
        deleteBtn.title = 'Delete';
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            this.deleteItem(item);
        };

        actions.appendChild(renameBtn);
        actions.appendChild(deleteBtn);

        row.appendChild(icon);
        row.appendChild(title);
        row.appendChild(actions);
        li.appendChild(row);

        row.onmousedown = (e) => {
            e.preventDefault(); // Prevent focus loss interference
            e.stopPropagation();
            Editor.save(); // Manually save current document since blur won't fire
            this.selectItem(item);
        };

        if (item.children && item.children.length > 0) {
            const childrenList = this.createList(item.children, false);
            li.appendChild(childrenList);
        }

        return li;
    },

    async selectItem(item) {
        this.selectedId = item.id;
        Tree.refresh();

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
        const bodyHtml = `<input type="text" id="rename-title" value="${item.title}">`;
        Modals.show('Rename', bodyHtml, async () => {
            const newTitle = document.getElementById('rename-title').value;
            await API.updateDocument(item.id, { title: newTitle });
            await this.refresh();
            if (Editor.currentDoc && Editor.currentDoc.id === item.id) {
                Editor.titleInput.value = newTitle;
            }
        });
    }
};
