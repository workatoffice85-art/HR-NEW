# API Interface Contracts: Photo Organizer

All communication between the Vite frontend and local Express backend uses JSON payloads over standard HTTP methods, hosted at `http://localhost:3000`.

## Endpoints Summary

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/albums` | Get all albums grouped by date |
| `POST` | `/api/albums` | Create a new album |
| `PUT` | `/api/albums/reorder` | Update the sorting order of albums |
| `DELETE` | `/api/albums/:id` | Delete an album and all its associated photos |
| `GET` | `/api/albums/:id/photos` | List all photo tiles inside an album |
| `POST` | `/api/albums/:id/photos` | Upload/import photos into a specific album |
| `DELETE` | `/api/photos/:id` | Delete a single photo |

---

## Detailed Endpoints

### 1. `GET /api/albums`
Retrieves all albums. Albums are returned as a flat list, ordered by date descending and sort_order ascending.

- **Response Header**: `Content-Type: application/json`
- **Response Payload (200 OK)**:
  ```json
  [
    {
      "id": 1,
      "name": "Graduation Day",
      "date": "2026-05-27",
      "sort_order": 0,
      "created_at": "2026-05-27 10:00:00",
      "photo_count": 5,
      "cover_photo": "/uploads/photo-1716801234.jpg"
    },
    {
      "id": 2,
      "name": "Beach BBQ",
      "date": "2026-05-27",
      "sort_order": 1,
      "created_at": "2026-05-27 10:15:00",
      "photo_count": 0,
      "cover_photo": null
    }
  ]
  ```

---

### 2. `POST /api/albums`
Creates a new album.

- **Request Payload**:
  ```json
  {
    "name": "Summer Outing",
    "date": "2026-05-20"
  }
  ```
- **Response Payload (201 Created)**:
  ```json
  {
    "id": 3,
    "name": "Summer Outing",
    "date": "2026-05-20",
    "sort_order": 0,
    "created_at": "2026-05-27 10:30:00"
  }
  ```

---

### 3. `PUT /api/albums/reorder`
Updates the sorting order of albums, typically called after a drag-and-drop event.

- **Request Payload**:
  ```json
  {
    "orders": [
      { "id": 1, "sort_order": 1 },
      { "id": 2, "sort_order": 0 }
    ]
  }
  ```
- **Response Payload (200 OK)**:
  ```json
  {
    "success": true,
    "message": "Album order successfully updated"
  }
  ```

---

### 4. `POST /api/albums/:id/photos`
Uploads and imports one or more photo files into an album. Expects `multipart/form-data` with one or more files in the `photos` field.

- **Request Content-Type**: `multipart/form-data`
- **Response Payload (201 Created)**:
  ```json
  {
    "success": true,
    "message": "3 photos successfully imported",
    "photos": [
      {
        "id": 12,
        "album_id": 1,
        "filename": "me.jpg",
        "local_path": "/uploads/1716801234-me.jpg",
        "file_size": 204857
      }
    ]
  }
  ```
