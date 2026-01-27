const Main = {
    async init() {
        try {
            await Tree.refresh();
        } catch (err) {
            console.error('Failed to load tree:', err);
        }

        document.getElementById('add-doc-btn').onclick = () => this.addNew();

        // Auto-save on blur
        Editor.titleInput.onblur = () => Editor.save();
        Editor.contentArea.onblur = () => Editor.save();

        // Export/Import stubs for now
        document.getElementById('export-doc-btn').onclick = () => this.exportCurrent();
        document.getElementById('export-all-btn').onclick = () => this.exportAll();
        document.getElementById('import-btn').onclick = () => this.showImport();
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
        const htmlContent = `
            <!DOCTYPE html>
            <html>
            <head><title>${Editor.currentDoc.title}</title><meta charset="utf-8"></head>
            <body>
                <h1>${Editor.currentDoc.title}</h1>
                ${Editor.contentArea.innerHTML}
            </body>
            </html>
        `;
        this.downloadFile(`${Editor.currentDoc.title}.html`, htmlContent);
    },

    async exportAll() {
        window.location.href = '/api/export/all';
    },

    showImport() {
        const bodyHtml = `<input type="file" id="import-file" accept=".html">`;
        Modals.show('Import HTML', bodyHtml, async () => {
            const file = document.getElementById('import-file').files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = async () => {
                const parser = new DOMParser();
                const doc = parser.parseFromString(reader.result, 'text/html');
                const title = doc.querySelector('title')?.textContent || 'Imported Doc';
                const content = doc.body.innerHTML;

                await API.createDocument({
                    title: title,
                    content: content,
                    is_folder: 0,
                    parent_id: Tree.selectedId
                });
                await Tree.refresh();
            };
            reader.readAsText(file);
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
