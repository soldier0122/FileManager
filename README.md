# File Manager

A self-hosted, web-based file manager. Run it on a VPS or home server and get a browser UI for uploading, organizing, previewing, and editing files

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
- 🔗 **Share links** — right-click → *Share* creates a public link (`/s/<token>`) that opens a simple download page, no login needed. Works for files and folders (folders download as `.zip`); switch it off again with *Stop sharing*
- 🖥️ **Right-click context menu** for quick actions on any item

  ## Screenshots
| | |
|:---:|:---:|
| <img width="100%" alt="screen_hub" src="https://github.com/user-attachments/assets/885ae0b9-b3bd-4752-a070-fcde547c0b3b" /> | <img width="100%" alt="screen_preview" src="https://github.com/user-attachments/assets/bf8618eb-cb08-42fb-bb23-1027dd43614c" /> |
| <img width="100%" alt="pdf_viewer" src="https://github.com/user-attachments/assets/6401db62-4255-43e8-957d-5052bd077f2b" /> | <img width="100%" alt="editor" src="https://github.com/user-attachments/assets/09d0abf4-cb01-4c36-88cc-a1ef9c99e65d" /> |

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
│   │   ├── database.js        # SQLite connection + schema (users, shares)
│   │   ├── storage.js         # STORAGE_ROOT + path sandboxing, shared by routes
│   │   ├── shares.js          # Share-link persistence (create / revoke / follow renames)
│   │   ├── middleware/
│   │   │   └── auth.js        # JWT verification middleware
│   │   └── routes/
│   │       ├── auth.js        # /api/auth (setup-status, register, login)
│   │       ├── files.js       # /api/files (browse, CRUD, upload, download, export)
│   │       └── share.js       # /api/share (create/revoke links, public download)
│   ├── storage/                # Files you upload live here (gitignored)
│   └── .env.example
└── frontend/
    ├── src/
    │   ├── components/
    │   │   ├── Dashboard.jsx   # Main file browser UI
    │   │   ├── LoginForm.jsx
    │   │   ├── RegisterForm.jsx
    │   │   ├── ShareModal.jsx  # "Share" dialog: copy link / stop sharing
    │   │   └── SharePage.jsx   # Public page a share link opens (/s/<token>)
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

Set `PUBLIC_URL` to the address people will reach the app at. It's the base of the share links the app generates (defaults to `https://dominikkrawczyk.duckdns.org`):

```
PUBLIC_URL=https://dominikkrawczyk.duckdns.org
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

Share links (`/s/<token>`) are handled by the frontend, so your web server must fall back to `index.html` for unknown paths, in addition to proxying `/api` to the backend. For example:

```nginx
location /      { root /path/to/frontend/dist; try_files $uri /index.html; }
location /api/  { proxy_pass http://localhost:3000; }
```

or with Caddy:

```
handle /api/* { reverse_proxy localhost:3000 }
handle        { root * /path/to/frontend/dist
                try_files {path} /index.html
                file_server }
```

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
| POST | `/api/share` | Create (or fetch) a public share link for a file/folder → `{ token, url }` |
| DELETE | `/api/share` | Stop sharing a file/folder |
| GET | `/api/share/:token` | **Public.** Name, type and size of the shared item |
| GET | `/api/share/:token/download` | **Public.** Download the shared file (or folder as `.zip`) |

## Security Notes

This project is meant for personal or small-scale self-hosting. If you deploy it publicly, keep the following in mind:

- Always set a long, random `JWT_SECRET` — the server refuses to start without one.
- Serve the app over HTTPS in production so credentials and tokens aren't sent in plaintext.
- Anyone who has a share link can download that item without logging in. Links are 128-bit random tokens (not guessable), but treat them like a password: use *Stop sharing* when you're done. Deleting a shared item also removes its link; renaming or moving it keeps the link working.
- The `storage/` directory can grow to contain sensitive files — make sure it's excluded from backups you don't control and isn't publicly web-accessible outside the app itself.

## License

This project is open-source and available under the MIT License.
