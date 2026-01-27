const Editor = {
    titleInput: document.getElementById('doc-title'),
    contentArea: document.getElementById('editor'),
    currentDoc: null,

    init() {
        document.getElementById('bold-btn').onclick = () => this.format('bold');
        document.getElementById('h1-btn').onclick = () => this.format('formatBlock', 'H1');
        document.getElementById('h2-btn').onclick = () => this.format('formatBlock', 'H2');
        document.getElementById('h3-btn').onclick = () => this.format('formatBlock', 'H3');
        document.getElementById('img-btn').onclick = () => this.insertImage();
        document.getElementById('delete-btn').onclick = () => this.delete();
    },

    format(cmd, val) {
        document.execCommand(cmd, false, val);
        this.contentArea.focus();
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
        if (confirm('Delete this document?')) {
            await API.deleteDocument(this.currentDoc.id);
            this.clear();
            Tree.refresh();
        }
    }
};

Editor.init();
