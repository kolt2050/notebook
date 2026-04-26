import sqlite3
import json
import base64
import os

def migrate():
    db_path = 'notebook.db'
    if not os.path.exists(db_path):
        # Check in data folder too
        db_path = os.path.join('data', 'notebook.db')
        if not os.path.exists(db_path):
            print("Error: notebook.db not found in root or data/ folder.")
            return

    print(f"Reading from {db_path}...")
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # Get documents
    cursor.execute("SELECT id, parent_id, title, content, is_folder, position, created_at, updated_at FROM documents")
    docs_rows = cursor.fetchall()
    documents = []
    max_doc_id = 0
    for row in docs_rows:
        d_id = row[0]
        if d_id > max_doc_id: max_doc_id = d_id
        documents.append({
            "id": d_id,
            "parent_id": row[1],
            "title": row[2],
            "content": row[3],
            "is_folder": row[4],
            "position": row[5],
            "created_at": row[6],
            "updated_at": row[7]
        })

    # Get images
    cursor.execute("SELECT id, document_id, filename, data, content_type FROM images")
    img_rows = cursor.fetchall()
    images = []
    max_img_id = 0
    for row in img_rows:
        i_id = row[0]
        if i_id > max_img_id: max_img_id = i_id
        
        # Convert BLOB to base64 string
        img_data = row[3]
        if img_data:
            b64_data = base64.b64encode(img_data).decode('utf-8')
        else:
            b64_data = ""

        images.append({
            "id": i_id,
            "document_id": row[1],
            "filename": row[2],
            "data": b64_data,
            "content_type": row[4]
        })

    output = {
        "documents": documents,
        "images": images,
        "next_id": max_doc_id + 1,
        "next_img_id": max_img_id + 1,
        "exported_at": "2026-04-26T00:00:00Z",
        "version": 1
    }

    with open('migration_backup.json', 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"Success! Exported {len(documents)} documents and {len(images)} images.")
    print("Now open your Portable Notebook extension and use 'Import DB' with 'migration_backup.json'.")

if __name__ == "__main__":
    migrate()
