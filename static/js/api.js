const API = {
    async getTree() {
        const res = await fetch('/api/tree');
        return res.json();
    },

    async getDocument(id) {
        const res = await fetch(`/api/documents/${id}`);
        if (!res.ok) throw new Error('Document not found');
        return res.json();
    },

    async createDocument(data) {
        const res = await fetch('/api/documents', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        return res.json();
    },

    async updateDocument(id, data) {
        const res = await fetch(`/api/documents/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        return res.json();
    },

    async deleteDocument(id) {
        const res = await fetch(`/api/documents/${id}`, {
            method: 'DELETE'
        });
        return res.ok;
    }
};
