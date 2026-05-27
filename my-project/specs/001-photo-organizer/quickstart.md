# Quickstart Guide: Photo Organizer

Follow these instructions to configure, run, and develop the Photo Organizer application on your local machine.

## Prerequisites

- **Node.js**: v18.0.0 or later installed.
- **npm** or **uv**: Installed and accessible in the system path.

## Installation

1. Install project dependencies for both the frontend (Vite) and backend (Express + SQLite):
   ```bash
   npm install
   ```

## Development Execution

1. Start both the backend Express server and the frontend Vite development server in concurrent mode:
   ```bash
   npm run dev
   ```
   - **Frontend Dashboard**: Open [http://localhost:5173](http://localhost:5173) in your browser.
   - **Local REST API**: Hosted at [http://localhost:3000](http://localhost:3000).

## Testing

To run the unified unit and integration test suite:
```bash
npm run test
```
- Tests are executed using **Vitest** for swift execution and continuous coverage verification.
