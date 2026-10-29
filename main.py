from fastapi import FastAPI, HTTPException, Header
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from pathlib import Path
import sqlite3, hashlib, secrets
from datetime import datetime

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "tasks.db"

app = FastAPI(title="Tasky — список задач")
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")

def connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with connect() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            salt TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            description TEXT DEFAULT '',
            due_date TEXT DEFAULT '',
            priority INTEGER DEFAULT 4,
            completed INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );
        """)

init_db()

class AuthData(BaseModel):
    username: str = Field(min_length=3, max_length=30)
    password: str = Field(min_length=6, max_length=100)

class TaskData(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=1000)
    due_date: str = ""
    priority: int = Field(default=4, ge=1, le=4)
    completed: bool = False

def password_hash(password, salt):
    return hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 180000).hex()

def current_user(authorization: str | None):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Сначала войдите в аккаунт")
    token = authorization[7:]
    with connect() as db:
        row = db.execute("SELECT user_id FROM sessions WHERE token=?", (token,)).fetchone()
    if not row:
        raise HTTPException(401, "Сессия закончилась. Войдите ещё раз")
    return row["user_id"]

@app.get("/")
def home():
    return FileResponse(BASE_DIR / "static" / "index.html")

@app.post("/api/register")
def register(data: AuthData):
    username = data.username.strip()
    if not username:
        raise HTTPException(400, "Введите имя пользователя")
    salt = secrets.token_hex(16)
    hashed = password_hash(data.password, salt)
    try:
        with connect() as db:
            cur = db.execute("INSERT INTO users(username,password_hash,salt) VALUES(?,?,?)",
                             (username, hashed, salt))
            user_id = cur.lastrowid
    except sqlite3.IntegrityError:
        raise HTTPException(400, "Такое имя пользователя уже занято")
    token = secrets.token_urlsafe(32)
    with connect() as db:
        db.execute("INSERT INTO sessions(token,user_id) VALUES(?,?)", (token, user_id))
    return {"token": token, "username": username}

@app.post("/api/login")
def login(data: AuthData):
    with connect() as db:
        user = db.execute("SELECT * FROM users WHERE username=?", (data.username.strip(),)).fetchone()
    if not user or not secrets.compare_digest(password_hash(data.password, user["salt"]), user["password_hash"]):
        raise HTTPException(401, "Неправильный логин или пароль")
    token = secrets.token_urlsafe(32)
    with connect() as db:
        db.execute("INSERT INTO sessions(token,user_id) VALUES(?,?)", (token, user["id"]))
    return {"token": token, "username": user["username"]}

@app.post("/api/logout")
def logout(authorization: str | None = Header(default=None)):
    if authorization and authorization.startswith("Bearer "):
        with connect() as db:
            db.execute("DELETE FROM sessions WHERE token=?", (authorization[7:],))
    return {"ok": True}

@app.get("/api/tasks")
def get_tasks(authorization: str | None = Header(default=None)):
    user_id = current_user(authorization)
    with connect() as db:
        rows = db.execute("SELECT * FROM tasks WHERE user_id=? ORDER BY completed, due_date='', due_date, id DESC",
                          (user_id,)).fetchall()
    return [dict(r) for r in rows]

@app.post("/api/tasks")
def create_task(data: TaskData, authorization: str | None = Header(default=None)):
    user_id = current_user(authorization)
    title = data.title.strip()
    if not title:
        raise HTTPException(400, "Название задачи не может быть пустым")
    with connect() as db:
        cur = db.execute("""INSERT INTO tasks(user_id,title,description,due_date,priority,completed,created_at)
                            VALUES(?,?,?,?,?,?,?)""",
                         (user_id, title, data.description, data.due_date, data.priority,
                          int(data.completed), datetime.now().isoformat(timespec="minutes")))
        task_id = cur.lastrowid
        row = db.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
    return dict(row)

@app.put("/api/tasks/{task_id}")
def update_task(task_id: int, data: TaskData, authorization: str | None = Header(default=None)):
    user_id = current_user(authorization)
    with connect() as db:
        cur = db.execute("""UPDATE tasks SET title=?,description=?,due_date=?,priority=?,completed=?
                            WHERE id=? AND user_id=?""",
                         (data.title.strip(), data.description, data.due_date, data.priority,
                          int(data.completed), task_id, user_id))
        if cur.rowcount == 0:
            raise HTTPException(404, "Задача не найдена")
        row = db.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
    return dict(row)

@app.delete("/api/tasks/{task_id}")
def delete_task(task_id: int, authorization: str | None = Header(default=None)):
    user_id = current_user(authorization)
    with connect() as db:
        cur = db.execute("DELETE FROM tasks WHERE id=? AND user_id=?", (task_id, user_id))
        if cur.rowcount == 0:
            raise HTTPException(404, "Задача не найдена")
    return {"ok": True}
