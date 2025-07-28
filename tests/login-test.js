import http from 'k6/http';
import { check } from 'k6';

export const options = {
  scenarios: {
    one_loop_per_user: {
      executor: 'per-vu-iterations',
      vus: 1,
      iterations: 1,
      maxDuration: '1s',
    },
  },
};

const BASE_URL = __ENV.BASE_URL;
const USERNAME = __ENV.ADMIN_USERNAME;
const PASSWORD = __ENV.ADMIN_PASSWORD;

export default function () {
  const payload = JSON.stringify({
    username: USERNAME,
    password: PASSWORD,
    remember: true,
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Client-Language': 'vi',
      'X-Client-Request': 'HERO',
    },
  };

  const res = http.post(`${BASE_URL}/api/auth/login`, payload, params);
  const body = res.json();

  console.log(`📨 Response from ${USERNAME}: ${JSON.stringify(body, null, 2)}`);

  check(res, {
    'status is 200': (r) => r.status === 200,
    'code == 200': () => body.code === 200,
    'message': () => body.message === 'Đăng nhập thành công',
  });
}
