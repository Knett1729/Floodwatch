# FloodWatch Talisay

## Deployment guide

### Frontend (Vercel)

1. Deploy the root repository as a static site on Vercel.
2. Add a Vercel environment variable named `API_BASE` and set it to your deployed backend URL, for example:
   ```text
   https://your-backend.onrender.com
   ```
3. Set the Vercel build command to:
   ```bash
   npm run build
   ```
4. Set the Vercel output directory to:
   ```text
   public
   ```
5. The build step generates `public/js/config.js` with the correct backend URL.
6. For local development, `js/config.js` still defaults to `http://localhost:5000` if you run the app without Vercel build.

### Backend (Render)

1. Create a new Web Service on Render.
2. Connect the service to this repository.
3. Use the following build command:
   ```bash
   pip install -r backend/requirements.txt
   ```
4. Use this start command:
   ```bash
   python backend/app.py
   ```
5. Render will expose a `PORT` environment variable automatically.
6. Your backend now reads `PORT` from the environment, so it will work correctly.

### Render service config

This repo includes `render.yaml`, which defines the backend service for Render:
- `name`: floodwatch-backend
- `env`: python
- `buildCommand`: install backend requirements
- `startCommand`: run `backend/app.py`
- `autoDeploy`: true

### Notes

- The backend is a long-running Flask service and must be hosted separately from the static frontend.
- The frontend should be deployed on Vercel and point to the backend URL using `js/config.js`.
- For real PAGASA data, upload `backend/rainfall_data.csv` and `backend/water_level_data.csv`, then set `GENERATE_FAKE_DATA = False` in `backend/train_model.py`.
