const Modals = {
    container: document.getElementById('modal-container'),
    title: document.getElementById('modal-title'),
    body: document.getElementById('modal-body'),
    confirmBtn: document.getElementById('modal-confirm'),
    cancelBtn: document.getElementById('modal-cancel'),
    modalWindow: document.querySelector('.modal'),
    onConfirm: null,

    init() {
        this.cancelBtn.onclick = () => this.hide();
        this.confirmBtn.onclick = () => {
            if (this.onConfirm) this.onConfirm();
            this.hide();
        };
    },

    show(title, bodyHtml, onConfirm, confirmType = 'primary', showCancel = true) {
        this.title.textContent = title;
        this.body.innerHTML = bodyHtml;
        this.onConfirm = onConfirm;

        // Reset classes
        this.confirmBtn.className = 'btn';
        this.modalWindow.className = 'modal';

        if (confirmType) {
            this.confirmBtn.classList.add(confirmType);
            this.modalWindow.classList.add(confirmType);
        }

        if (showCancel) {
            this.cancelBtn.classList.remove('hidden');
        } else {
            this.cancelBtn.classList.add('hidden');
        }

        this.container.classList.remove('hidden');
    },

    showInfo(title, message, onConfirm) {
        this.show(title, `<p>${message}</p>`, onConfirm, 'primary', false);
    },

    showConfirm(title, message, onConfirm, confirmType = 'primary') {
        this.show(title, `<p>${message}</p>`, onConfirm, confirmType, true);
    },

    hide() {
        this.container.classList.add('hidden');
        this.onConfirm = null;
    }
};

Modals.init();
