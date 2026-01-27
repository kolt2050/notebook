const Editor = {
    titleInput: document.getElementById('doc-title'),
    contentArea: document.getElementById('editor'),
    currentDoc: null,

    init() {
        document.getElementById('bold-btn').onclick = () => this.format('bold');
        document.getElementById('delete-btn').onclick = () => this.delete();

        // Support pasting images
        this.contentArea.onpaste = (e) => this.handlePaste(e);
    },

    format(cmd, val) {
        document.execCommand(cmd, false, val);
        this.contentArea.focus();
    },


    handlePaste(e) {
        const items = (e.clipboardData || e.originalEvent.clipboardData).items;
        for (const item of items) {
            if (item.type.indexOf('image') !== -1) {
                e.preventDefault(); // Prevent browser's default paste behavior
                const file = item.getAsFile();
                const reader = new FileReader();
                reader.onload = (event) => {
                    const img = `<img src="${event.target.result}" alt="Pasted Image">`;
                    this.format('insertHTML', img);
                };
                reader.readAsDataURL(file);
                return; // Exit after handling image
            }
        }
    },

    insertImage() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = e => {
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onload = () => {
                const img = `<img src="${reader.result}" alt="${file.name}">`;
                this.format('insertHTML', img);
            };
            reader.readAsDataURL(file);
        };
        input.click();
    },

    load(doc) {
        this.currentDoc = doc;
        this.titleInput.value = doc.title;
        this.contentArea.innerHTML = doc.content || '';
        this.contentArea.setAttribute('placeholder', 'Type something...');
    },

    clear() {
        this.currentDoc = null;
        this.titleInput.value = '';
        this.contentArea.innerHTML = '';
        this.contentArea.setAttribute('placeholder', 'Select a document to edit');
    },

    async save() {
        if (!this.currentDoc) return;
        const data = {
            title: this.titleInput.value,
            content: this.contentArea.innerHTML
        };
        await API.updateDocument(this.currentDoc.id, data);
        Tree.refresh();
    },

    async delete() {
        if (!this.currentDoc) return;
        Modals.show('Delete Document', `<p>Delete "${this.currentDoc.title}"?</p>`, async () => {
            await API.deleteDocument(this.currentDoc.id);
            this.clear();
            Tree.refresh();
        }, 'danger');
    }
};

Editor.init();
