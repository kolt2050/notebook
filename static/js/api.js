const API = {
    async getTree() {
        const res = await fetch('/api/tree');
        if (!res.ok) throw new Error('Failed to fetch tree');
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
        if (!res.ok) {
            let errorMsg = 'Failed to create document';
            try {
                const err = await res.json();
                errorMsg = err.detail || errorMsg;
            } catch (e) {
                const text = await res.text();
                errorMsg = text || errorMsg;
            }
            throw new Error(errorMsg);
        }
        return res.json();
    },

    async updateDocument(id, data) {
        const res = await fetch(`/api/documents/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!res.ok) {
            let errorMsg = 'Failed to update document';
            try {
                const err = await res.json();
                errorMsg = err.detail || errorMsg;
            } catch (e) {
                const text = await res.text();
                errorMsg = text || errorMsg;
            }
            throw new Error(errorMsg);
        }
        return res.json();
    },

    async deleteDocument(id) {
        const res = await fetch(`/api/documents/${id}`, {
            method: 'DELETE'
        });
        return res.ok;
    },

    async deleteAllDocuments() {
        const res = await fetch('/api/danger/all', {
            method: 'DELETE'
        });
        return res.ok;
    },

    async getDocCount() {
        const res = await fetch('/api/stats/count');
        const data = await res.json();
        return data.count;
    },

    async search(query) {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        return res.json();
    }
};
