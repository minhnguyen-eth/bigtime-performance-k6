import http from 'k6/http';
import { check, sleep, fail } from 'k6';
import { SharedArray } from 'k6/data';

const BASE_URL = __ENV.BASE_URL 
const DEFAULT_USERNAME = __ENV.ADMIN_USERNAME 
const DEFAULT_PASSWORD = __ENV.ADMIN_PASSWORD 

const ENDPOINTS = {
  LOGIN: '/api/auth/login',
  TOTAL_TYPE: '/api/notification/get-total-type-auth',
  ALL_SENT: '/api/notification/get-all-sent-auth',
};

const DEFAULT_HEADERS = {
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'x-client-request': 'hero',
  'x-client-language': 'vi',
};

let users;
try {
  users = new SharedArray('users', () => {
    const data = JSON.parse(open('./users.json'));
    if (!data || !Array.isArray(data) || data.length === 0) {
      throw new Error('Invalid or empty users.json');
    }
    return data.filter(user => user.username && user.password);
  });
} catch (e) {
  console.error(`Failed to load users.json: ${e.message}`);
  users = [{ username: DEFAULT_USERNAME, password: DEFAULT_PASSWORD }];
}

export const options = {
  scenarios: {
    simultaneous_users: {
      executor: 'per-vu-iterations',
      vus: Math.min(users.length, 1),
      iterations: 1,
      maxDuration: '30s',
      gracefulStop: '30s',
    },
  },
  thresholds: {
    'http_req_failed{name:login}': ['rate<0.1'],
    'http_req_failed{name:total-type}': ['rate<0.5'],
    'http_req_failed{name:all-sent}': ['rate<0.1'],
    'http_req_duration': ['p(95)<800'],
    'checks': ['rate>0.8'],
  },
};

// Hàm GET an toàn với log chi tiết
function safeGet(url, headers, name, username, retries = 3, wait = 0.5) {
  for (let i = 0; i <= retries; i++) {
    const res = http.get(url, { headers, tags: { name } });

    if (res && res.status === 200) {
      console.log(`[${username}] ${name} success: ${url} (${res.status}) [${res.timings.duration}ms]`);
      return res;
    }

    console.warn(`[${username}] Attempt ${i + 1}/${retries + 1} - ${name} failed`);
    console.warn(`URL: ${url}`);
    console.warn(`Status: ${res ? res.status : 'No response'}`);
    console.warn(`Duration: ${res ? res.timings.duration : 'N/A'}ms`);
    console.warn(`Request headers: ${JSON.stringify(headers, null, 2)}`);

    if (res) {
      console.warn(`Response body:\n${res.body}`);
    }

    if (i < retries) sleep(wait);
  }

  console.error(`[${username}] All retries failed for ${name} - ${url}`);
  return null;
}

// Hàm đăng nhập với log chi tiết
function login(user, headers) {
  const payload = JSON.stringify({
    username: user.username,
    password: user.password,
    remember: true,
  });

  const res = http.post(`${BASE_URL}${ENDPOINTS.LOGIN}`, payload, {
    headers,
    tags: { name: 'login' },
  });

  const success = check(res, {
    'login succeeded': (r) => r.status === 200 && r.json('data.access_token'),
  });

  if (!success) {
    console.error(`Login failed for ${user.username}`);
    console.error(`Status: ${res.status}`);
    console.error(`Duration: ${res.timings.duration}ms`);
    console.error(`Request payload: ${payload}`);
    console.error(`Response body: ${res.body}`);
    return null;
  }

  const token = res.json('data.access_token');
  console.log(`[${user.username}] Login OK - Token: ${token.slice(0, 12)}...`);
  return token;
}

// Kịch bản chính
export default function () {
  const userIndex = (__VU - 1) % users.length;
  const user = users[userIndex] || { username: DEFAULT_USERNAME, password: DEFAULT_PASSWORD };
  console.log(`[VU ${__VU}] Testing with user: ${user.username}`);

  const token = login(user, DEFAULT_HEADERS);
  if (!token) return;

  const authHeaders = {
    ...DEFAULT_HEADERS,
    Authorization: `Bearer ${token}`,
  };

  sleep(1); // Đợi token được xác nhận backend

  const totalTypeRes = safeGet(`${BASE_URL}${ENDPOINTS.TOTAL_TYPE}`, authHeaders, 'total-type', user.username);
  const totalOK = check(totalTypeRes, {
    'get-total-type-auth is 200': (r) => r !== null && r.status === 200,
  }, { skip: !totalTypeRes });

  if (!totalOK && totalTypeRes) {
    console.error(`[${user.username}] get-total-type-auth failed`);
    console.error(`Status: ${totalTypeRes.status}`);
    console.error(`Body: ${totalTypeRes.body}`);
  }

  const notifRes = safeGet(`${BASE_URL}${ENDPOINTS.ALL_SENT}`, authHeaders, 'all-sent', user.username);
  const notifOK = check(notifRes, {
    'get-all-sent-auth is 200': (r) => r !== null && r.status === 200,
  }, { skip: !notifRes });

  if (!notifOK && notifRes) {
    console.error(`[${user.username}] get-all-sent-auth failed`);
    console.error(`Status: ${notifRes.status}`);
    console.error(`Body: ${notifRes.body}`);
  }

  sleep(0.3);
}
