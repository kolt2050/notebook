import sqlite3
import os

def migrate():
    db_path = os.path.join(os.path.dirname(__file__), "..", "..", "data", "notebook.db")
    if not os.path.exists(db_path):
        # Fallback for local dev if data/ is not there or path is different
        db_path = "notebook.db" 
        if not os.path.exists(db_path):
            print("Database not found, skipping migration.")
            return

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Check if position column exists
    cursor.execute("PRAGMA table_info(documents)")
    columns = [row[1] for row in cursor.fetchall()]
    
    if "position" not in columns:
        print("Adding 'position' column to 'documents' table...")
        cursor.execute("ALTER TABLE documents ADD COLUMN position INTEGER DEFAULT 0")
        conn.commit()
        print("Migration successful.")
    else:
        print("'position' column already exists.")
    
    conn.close()

if __name__ == "__main__":
    migrate()
