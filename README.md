# File Manager

A self-hosted, web-based file manager. Run it on a VPS or home server and get a browser UI for uploading, organizing, previewing, and editing files — protected by a single admin login.

![File Manager](frontend/src/assets/hero.png)

## Features

- 🔐 **Single-admin authentication** — first-run setup creates one admin account (registration locks itself after that), sessions handled with JWT
- 📁 **Full file browser** — folders and files sorted and rendered in a grid, with breadcrumb navigation
- ⬆️ **Uploads** — drag-and-drop files from your OS straight into the browser, or use the upload button
- 🖱️ **Drag-and-drop organizing** — drag items between folders, onto breadcrumbs, or up a level to move them
- ✏️ **In-browser code/text editing** — built-in [Monaco Editor](https://microsoft.github.io/monaco-editor/) (the engine behind VS Code) with language-aware syntax highlighting
- 👀 **Preview** — view images and text/code files without downloading them
- 📦 **Export as ZIP** — download a whole folder as a `.zip`, or download single files directly
- 🗂️ **Standard file ops** — create folders and text files, rename, copy, move, and delete
- 🖥️ **Right-click context menu** for quick actions on any item

## Tech Stack

**Backend**
- [Express 5](https://expressjs.com/) — REST API
- [SQLite](https://www.sqlite.org/) (via `sqlite3`) — stores the admin user
- [bcrypt](https://www.npmjs.com/package/bcrypt) — password hashing
- [jsonwebtoken](https://www.npmjs.com/package/jsonwebtoken) — auth tokens
- [multer](https://www.npmjs.com/package/multer) — file uploads
- [archiver](https://www.npmjs.com/package/archiver) — on-the-fly ZIP export

**Frontend**
- [React 19](https://react.dev/) + [Vite](https://vitejs.dev/)
- [@monaco-editor/react](https://www.npmjs.com/package/@monaco-editor/react) — in-browser code editor

## Project Structure

```
file-manager/
├── backend/
│   ├── src/
│   │   ├── server.js          # Express app entrypoint
│   │   ├── database.js        # SQLite connection + schema
│   │   ├── middleware/
│   │   │   └── auth.js        # JWT verification middleware
│   │   └── routes/
│   │       ├── auth.js        # /api/auth (setup-status, register, login)
│   │       └── files.js       # /api/files (browse, CRUD, upload, download, export)
│   ├── storage/                # Files you upload live here (gitignored)
│   └── .env.example
└── frontend/
    ├── src/
    │   ├── components/
    │   │   ├── Dashboard.jsx   # Main file browser UI
    │   │   ├── LoginForm.jsx
    │   │   └── RegisterForm.jsx
    │   └── App.jsx             # Routes between setup / login / dashboard
    └── vite.config.js          # Dev server proxy to the backend
```

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+ and npm

### 1. Clone the repo

```bash
git clone <this-repo-url>
cd file-manager
```

### 2. Set up the backend

```bash
cd backend
npm install
cp .env.example .env
```

Open `.env` and set a strong, random `JWT_SECRET`:

```
JWT_SECRET=your_super_secret_key_here
```

Optionally set `STORAGE_ROOT` to point uploaded files somewhere other than the default `backend/storage/`:

```
STORAGE_ROOT=/path/to/your/files
```

Start the backend:

```bash
npm start
```

The API runs on **http://localhost:3000** (health check at `/api/health`).

### 3. Set up the frontend

In a new terminal:

```bash
cd frontend
npm install
npm run dev
```

The dev server runs on **http://localhost:5173** and proxies `/api` requests to the backend on port 3000 (see `vite.config.js`).

### 4. First run

Open the frontend in your browser. Since no admin account exists yet, you'll be prompted to create one — this is a one-time setup; the registration endpoint locks itself after the first account is created. From then on you'll see the login screen.

## Building for Production

```bash
cd frontend
npm run build
```

This outputs static assets to `frontend/dist/`. Serve them with any static file host (or add static serving to the Express backend) and point it at the running backend API.

## API Overview

All `/api/files/*` routes (except where noted) require a `Bearer <token>` header obtained from `/api/auth/login`. Paths are always relative to `STORAGE_ROOT` and are sandboxed — the backend rejects any path that resolves outside of it.

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/auth/setup-status` | Check whether an admin account already exists |
| POST | `/api/auth/register` | Create the admin account (only works once) |
| POST | `/api/auth/login` | Log in and receive a JWT |
| GET | `/api/files?path=` | List contents of a directory |
| GET | `/api/files/read?path=` | Read a text file's contents |
| PUT | `/api/files/update` | Save edited file contents |
| POST | `/api/files/folder` | Create a new folder |
| POST | `/api/files/text` | Create a new text file |
| PUT | `/api/files/rename` | Rename a file or folder |
| PUT | `/api/files/move` | Move a file or folder |
| POST | `/api/files/copy` | Copy a file or folder |
| DELETE | `/api/files/delete` | Delete a file or folder |
| GET | `/api/files/download?path=` | Stream a file's raw contents |
| GET | `/api/files/export?path=` | Download a file, or a folder as a `.zip` |
| POST | `/api/files/upload` | Upload one or more files (`multipart/form-data`) |

## Security Notes

This project is meant for personal or small-scale self-hosting. If you deploy it publicly, keep the following in mind:

- Always set a long, random `JWT_SECRET` — the server refuses to start without one.
- Serve the app over HTTPS in production so credentials and tokens aren't sent in plaintext.
- The `storage/` directory can grow to contain sensitive files — make sure it's excluded from backups you don't control and isn't publicly web-accessible outside the app itself.

## License

This project is open-source and available under the MIT License.
