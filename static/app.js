const $ = (id) => document.getElementById(id);
let token = localStorage.getItem("tasky_token") || "";
let username = localStorage.getItem("tasky_username") || "";
let authMode = "login";
let tasks = [];
let filter = "all";
let editingId = null;
let toastTimer;

const titles = {
  all: ["Входящие", "Все задачи в одном месте."],
  today: ["Сегодня", "Задачи, которые запланированы на сегодня."],
  upcoming: ["Предстоящие", "Что нужно сделать в ближайшее время."],
  completed: ["Выполненные", "То, что уже удалось сделать."]
};

function showToast(message) {
  $("toast").textContent = message;
  $("toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("show"), 2300);
}
async function api(path, options = {}) {
  const headers = {"Content-Type": "application/json", ...(options.headers || {})};
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(path, {...options, headers});
  const data = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && token) signOut(false);
    throw new Error(data.detail || "Что-то пошло не так");
  }
  return data;
}
function showAuth(mode) {
  authMode = mode;
  $("auth-title").textContent = mode === "login" ? "С возвращением!" : "Создать аккаунт";
  $("auth-subtitle").textContent = mode === "login" ? "Войдите, чтобы увидеть свои задачи." : "Зарегистрируйтесь и планируйте свой день.";
  $("auth-submit").textContent = mode === "login" ? "Войти" : "Зарегистрироваться";
  $("auth-switch").innerHTML = mode === "login"
    ? 'Нет аккаунта? <button class="text-button" id="switch-auth">Зарегистрироваться</button>'
    : 'Уже есть аккаунт? <button class="text-button" id="switch-auth">Войти</button>';
  $("switch-auth").addEventListener("click", () => showAuth(authMode === "login" ? "register" : "login"));
  $("auth-password").autocomplete = mode === "login" ? "current-password" : "new-password";
  $("auth-message").textContent = "";
}
$("auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("auth-message").textContent = "";
  const button = $("auth-submit");
  button.disabled = true;
  button.textContent = "Подождите…";
  try {
    const data = await api(`/api/${authMode}`, {method:"POST", body:JSON.stringify({
      username:$("auth-username").value.trim(), password:$("auth-password").value
    })});
    token = data.token; username = data.username;
    localStorage.setItem("tasky_token", token);
    localStorage.setItem("tasky_username", username);
    await enterApp();
  } catch (error) {
    $("auth-message").textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = authMode === "login" ? "Войти" : "Зарегистрироваться";
  }
});
function enterApp() {
  $("auth-screen").classList.add("hidden");
  $("app").classList.remove("hidden");
  $("username-label").textContent = username;
  $("avatar").textContent = (username[0] || "T").toUpperCase();
  $("today-label").textContent = new Date().toLocaleDateString("ru-RU", {weekday:"short", day:"numeric", month:"long"});
  return loadTasks();
}
async function signOut(callApi = true) {
  if (callApi && token) { try { await api("/api/logout", {method:"POST"}); } catch (_) {} }
  token = ""; username = ""; tasks = [];
  localStorage.removeItem("tasky_token"); localStorage.removeItem("tasky_username");
  $("app").classList.add("hidden"); $("auth-screen").classList.remove("hidden");
  $("auth-password").value = "";
  showAuth("login");
}
$("logout").addEventListener("click", () => signOut(true));

async function loadTasks() {
  try { tasks = await api("/api/tasks"); renderTasks(); }
  catch (error) { showToast(error.message); }
}
function getVisibleTasks() {
  const now = new Date();
  return tasks.filter(task => {
    if (filter === "completed") return !!task.completed;
    if (task.completed) return false;
    if (filter === "today") {
      if (!task.due_date) return false;
      const due = new Date(task.due_date);
      return due.toDateString() === now.toDateString();
    }
    if (filter === "upcoming") {
      if (!task.due_date) return false;
      return new Date(task.due_date) >= new Date(now.toDateString());
    }
    return true;
  });
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
}
function renderTasks() {
  $("all-count").textContent = tasks.filter(t => !t.completed).length;
  $("page-title").textContent = titles[filter][0];
  $("page-subtitle").textContent = titles[filter][1];
  document.querySelectorAll(".nav-item").forEach(btn => btn.classList.toggle("active", btn.dataset.filter === filter));
  const visible = getVisibleTasks();
  $("task-list").innerHTML = visible.map(task => {
    const priorityNames = {1:"Срочный",2:"Высокий",3:"Средний",4:"Обычный"};
    let due = "";
    if (task.due_date) {
      const date = new Date(task.due_date);
      const isOverdue = date < new Date() && !task.completed;
      due = `<span class="due ${isOverdue ? "overdue" : ""}">◷ ${escapeHtml(date.toLocaleString("ru-RU",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}))}</span>`;
    }
    const description = task.description ? `<div class="task-description">${escapeHtml(task.description)}</div>` : "";
    return `<article class="task ${task.completed ? "completed" : ""}">
      <button class="task-check" data-action="toggle" data-id="${task.id}" title="${task.completed ? "Вернуть в задачи" : "Отметить выполненной"}">${task.completed ? "✓" : ""}</button>
      <div class="task-body"><div class="task-title">${escapeHtml(task.title)}</div>${description}
        <div class="task-meta">${due}<span class="priority p${task.priority}">${priorityNames[task.priority] || "Обычный"}</span></div>
      </div>
      <div class="task-actions"><button class="icon-btn" data-action="edit" data-id="${task.id}" title="Изменить">✎</button><button class="icon-btn" data-action="delete" data-id="${task.id}" title="Удалить">×</button></div>
    </article>`;
  }).join("");
  $("empty-state").classList.toggle("hidden", visible.length !== 0);
  $("task-list").classList.toggle("hidden", visible.length === 0);
}
document.querySelectorAll(".nav-item").forEach(btn => btn.addEventListener("click", () => { filter = btn.dataset.filter; renderTasks(); }));
function openModal(task = null) {
  editingId = task ? task.id : null;
  $("modal-title").textContent = task ? "Изменить задачу" : "Новая задача";
  $("task-title").value = task?.title || "";
  $("task-description").value = task?.description || "";
  $("task-due").value = task?.due_date || "";
  $("task-priority").value = String(task?.priority || 4);
  $("task-message").textContent = "";
  $("task-modal").classList.remove("hidden");
  $("task-title").focus();
}
function closeModal() { $("task-modal").classList.add("hidden"); }
["add-task","sidebar-add","empty-add"].forEach(id => $(id).addEventListener("click", () => openModal()));
$("close-modal").addEventListener("click", closeModal);
$("cancel-modal").addEventListener("click", closeModal);
$("task-modal").addEventListener("click", event => { if (event.target === $("task-modal")) closeModal(); });
document.addEventListener("keydown", event => { if (event.key === "Escape") closeModal(); });
$("task-form").addEventListener("submit", async event => {
  event.preventDefault();
  const data = {
    title:$("task-title").value.trim(),
    description:$("task-description").value.trim(),
    due_date:$("task-due").value,
    priority:Number($("task-priority").value),
    completed:!!tasks.find(t => t.id === editingId)?.completed
  };
  try {
    await api(editingId ? `/api/tasks/${editingId}` : "/api/tasks", {
      method: editingId ? "PUT" : "POST", body:JSON.stringify(data)
    });
    closeModal(); await loadTasks(); showToast(editingId ? "Задача обновлена" : "Задача добавлена");
  } catch (error) { $("task-message").textContent = error.message; }
});
$("task-list").addEventListener("click", async event => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const id = Number(button.dataset.id);
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  try {
    if (button.dataset.action === "toggle") {
      await api(`/api/tasks/${id}`, {method:"PUT",body:JSON.stringify({...task,completed:!task.completed})});
      await loadTasks(); showToast(task.completed ? "Задача снова активна" : "Задача выполнена");
    } else if (button.dataset.action === "edit") openModal(task);
    else if (button.dataset.action === "delete") {
      if (!confirm(`Удалить задачу «${task.title}»?`)) return;
      await api(`/api/tasks/${id}`, {method:"DELETE"}); await loadTasks(); showToast("Задача удалена");
    }
  } catch (error) { showToast(error.message); }
});

showAuth("login");
if (token && username) enterApp().catch(() => signOut(false));
