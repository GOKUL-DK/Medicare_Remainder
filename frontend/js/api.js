const RENDER_BACKEND_URL = 'https://medicare-remainder.onrender.com/api';

const API = {
  // Dynamically target Render backend when deployed on Vercel
  base: window.location.hostname.includes('vercel.app')
    ? RENDER_BACKEND_URL
    : '/api',

  token() {
    return localStorage.getItem('mc_token');
  },

  setSession(token, user, role) {
    localStorage.setItem('mc_token', token);
    localStorage.setItem('mc_user', JSON.stringify(user));
    localStorage.setItem('mc_role', role);
  },

  clearSession() {
    localStorage.removeItem('mc_token');
    localStorage.removeItem('mc_user');
    localStorage.removeItem('mc_role');
  },

  currentUser() {
    const raw = localStorage.getItem('mc_user');
    return raw ? JSON.parse(raw) : null;
  },

  currentRole() {
    return localStorage.getItem('mc_role');
  },

  async request(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    const token = this.token();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    let res;
    try {
      res = await fetch(this.base + path, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (netErr) {
      // Fallback check if Vercel serverless /api route is present
      if (this.base === RENDER_BACKEND_URL) {
        try {
          res = await fetch('/api' + path, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
          });
        } catch (e) {
          throw new Error('Server connection failed. Render free tier may be spinning up — please try again in 10-20 seconds.');
        }
      } else {
        throw new Error('Unable to connect to MediCare server.');
      }
    }

    if (res.status === 401 && !path.startsWith('/auth/login')) {
      this.clearSession();
      window.location.href = '/index.html';
      return null;
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  },

  get(path) { return this.request('GET', path); },
  post(path, body) { return this.request('POST', path, body); },
  put(path, body) { return this.request('PUT', path, body); },
  del(path) { return this.request('DELETE', path); },
};

function requireRole(expectedRole) {
  const role = API.currentRole();
  if (!API.token() || role !== expectedRole) {
    window.location.href = '/index.html';
  }
}

function logout() {
  API.clearSession();
  window.location.href = '/index.html';
}

function fmtDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString();
}

function statusBadge(status) {
  return `<span class="badge ${status}">${status}</span>`;
}
