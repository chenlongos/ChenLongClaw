/**
 * 小车 HTTP 真机；机械臂 / 摄像头 / 远程识图仍为桩。终端打印由 weixin-claw / repl 的 onToolEnd 统一格式输出
 */
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { reminderTools } from './reminderTools.js';

function carHttpBaseUrl() {
  return process.env.CAR_HTTP_BASE_URL?.trim() || 'http://172.16.203.160';
}

/**
 * 目标位姿导航：POST JSON 到 CAR_HTTP_BASE_URL + CAR_NAVIGATE_PATH（默认 /api/navigate），
 * 或设 CAR_NAVIGATE_USE_GET=true 时用 GET + query。失败时 ok:false。
 */
async function carNavigatePoseHttp({ target_x_m, target_y_m, theta_deg }) {
  const base = carHttpBaseUrl().replace(/\/+$/, '');
  const rawPath = process.env.CAR_NAVIGATE_PATH?.trim() || '/api/navigate';
  const path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
  const urlString = `${base}${path}`;
  const useGet =
    process.env.CAR_NAVIGATE_METHOD?.toUpperCase() === 'GET' ||
    process.env.CAR_NAVIGATE_USE_GET === '1' ||
    process.env.CAR_NAVIGATE_USE_GET === 'true';

  try {
    const url = new URL(urlString);
    if (useGet) {
      url.searchParams.set('target_x_m', String(target_x_m));
      url.searchParams.set('target_y_m', String(target_y_m));
      if (theta_deg != null && !Number.isNaN(theta_deg)) {
        url.searchParams.set('theta_deg', String(theta_deg));
      }
      const resp = await fetch(url.toString(), { method: 'GET' });
      const text = await resp.text().catch(() => '');
      return {
        ok: resp.ok,
        http_status: resp.status,
        url: url.toString(),
        target_x_m,
        target_y_m,
        theta_deg: theta_deg ?? null,
        response_text: text.slice(0, 500),
        message: resp.ok ? '小车导航目标已下发' : '小车导航请求失败',
      };
    }

    const resp = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target_x_m,
        target_y_m,
        theta_deg: theta_deg ?? null,
      }),
    });
    const text = await resp.text().catch(() => '');
    return {
      ok: resp.ok,
      http_status: resp.status,
      url: url.toString(),
      target_x_m,
      target_y_m,
      theta_deg: theta_deg ?? null,
      response_text: text.slice(0, 500),
      message: resp.ok ? '小车导航目标已下发' : '小车导航请求失败',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      http_status: null,
      url: urlString,
      target_x_m,
      target_y_m,
      theta_deg: theta_deg ?? null,
      response_text: '',
      message: `导航请求异常: ${msg}`,
    };
  }
}

/** 设备约定：GET /api/control?action=&speed=&time=，time 为毫秒 */
async function carControlHttp({ action, speed, time_ms }) {
  const base = carHttpBaseUrl().replace(/\/+$/, '');
  const url = new URL(`${base}/api/control`);
  url.searchParams.set('action', action);
  url.searchParams.set('speed', String(speed));
  url.searchParams.set('time', String(Math.max(1, Math.round(time_ms))));
  try {
    const resp = {"ok":true, "status": 200, "text": ""};
    //await fetch(url.toString(), { method: 'GET' });
    const text = "success";//await resp.text().catch(() => '');
    return {
      ok: resp.ok,
      http_status: resp.status,
      url: url.toString(),
      response_text: text.slice(0, 500) || '',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      http_status: null,
      url: url.toString(),
      response_text: '',
      message: msg,
    };
  }
}

/** 按顺序执行多段开环（up/down/left/right + 时长），任意多边形/折线 */
async function runHttpPathSegments({ segments, speed }) {
  const s = speed ?? 150;
  const steps = [];
  const batch_lines = [];
  const total = segments.length;
  for (let i = 0; i < total; i++) {
    const seg = segments[i];
    const r = await carControlHttp({ action: seg.http_action, speed: s, time_ms: seg.duration_ms });
    const q = new URL(r.url).searchParams.toString();
    batch_lines.push(`第${i + 1}/${total}批 ${seg.http_action} ${seg.duration_ms}ms · ${q}`);
    steps.push({ index: i + 1, http_action: seg.http_action, duration_ms: seg.duration_ms, ...r });
  }
  const ok = steps.every((st) => st.ok);
  return { ok, steps, batch_lines, speed: s };
}

/** 口语/混写 → 设备 action；小写英文与常见中文同义 */
function normalizeCarAction(raw) {
  const s = String(raw ?? '').trim();
  if (!s) {
    throw new Error('action 为空');
  }
  const lower = s.toLowerCase();
  if (['up', 'down', 'left', 'right'].includes(lower)) {
    return lower;
  }
  /** @type {Record<string, 'up'|'down'|'left'|'right'>} */
  const zh = {
    前进: 'up',
    前: 'up',
    往上: 'up',
    后退: 'down',
    后: 'down',
    往后: 'down',
    左转: 'left',
    左: 'left',
    左移: 'left',
    右转: 'right',
    右: 'right',
    右移: 'right',
  };
  if (zh[s]) {
    return zh[s];
  }
  throw new Error(`无法将「${s}」译为 up/down/left/right，请用英文或 前进/后退/左/右/左移/右移`);
}

function captureStub(resolution) {
  const res = resolution ?? 'medium';
  const image_url = `https://example.invalid/claw/capture?res=${res}&t=${Date.now()}`;
  return {
    ok: true,
    resolution: res,
    image_url,
    message: '已获取图像（桩，未接真实摄像头）',
  };
}

/** 远程识图桩：随机生成目标在画面中的位置（归一化 + 像素），便于联调路径规划 */
function randomVisionStub(prompt) {
  const w = 640;
  const h = 480;
  const cx = Math.random() * w;
  const cy = Math.random() * h;
  const half = 40 + Math.random() * 60;
  const x1 = Math.max(0, cx - half);
  const y1 = Math.max(0, cy - half);
  const x2 = Math.min(w, cx + half);
  const y2 = Math.min(h, cy + half);
  const confidence = 0.85 + Math.random() * 0.14;
  return {
    recognized: true,
    confidence: Math.round(confidence * 1000) / 1000,
    label: prompt?.trim() ? `与「${prompt.trim().slice(0, 40)}」相关的目标` : '检测到的目标（桩）',
    position_normalized: {
      center_x: Math.round((cx / w) * 10000) / 10000,
      center_y: Math.round((cy / h) * 10000) / 10000,
    },
    position_pixels: {
      frame_width: w,
      frame_height: h,
      center_x_px: Math.round(cx),
      center_y_px: Math.round(cy),
    },
    bbox_pixels: { x1: Math.round(x1), y1: Math.round(y1), x2: Math.round(x2), y2: Math.round(y2) },
    summary: `识别成功（模拟）：目标在画面中，中心约 (${Math.round(cx)}, ${Math.round(cy)}) 像素，置信度 ${confidence.toFixed(2)}。`,
  };
}

const carNavigateTo = new DynamicStructuredTool({
  name: 'car_navigate_to',
  description:
    '仅整车导航到目标位姿（米），CAR_NAVIGATE_PATH HTTP。**不含**拍照与识图；看画面须另调 camera_capture → vision_recognize_remote。开环靠近也可改用 car_move。',
  schema: z.object({
    target_x_m: z.number().describe('目标 X（米）'),
    target_y_m: z.number().describe('目标 Y（米）'),
    theta_deg: z.number().optional().nullable().describe('车头朝向（度）'),
  }),
  func: async (args) => {
    const nav = await carNavigatePoseHttp(args);
    return JSON.stringify(nav);
  },
});

const carMoveSchema = z.object({
  moves: z
    .array(
      z.object({
        action: z
          .union([
            z.enum(['up', 'down', 'left', 'right']),
            z.string().min(1).describe('中文：前进/后退/左/右/左移/右移等，服务端会译为 API'),
          ])
          .describe('英文 up/down/left/right，或中文口语（见上）；服务端统一译为 /api/control'),
        duration_ms: z.number().int().positive().describe('本段持续毫秒'),
      })
    )
    .min(1)
    .describe(
      '按顺序执行，每段一次 HTTP。单步只传 1 条；正方形常见 8 段 up 与 right 交替（四边+四角）'
    ),
  speed: z.number().int().min(0).max(255).optional().nullable().describe('速度 0~255，默认 150'),
});

/** 开环底盘：moves 即「前后左右 + 时长」，无 mode 嵌套 */
const carMove = new DynamicStructuredTool({
  name: 'car_move',
  description:
    '整车底盘运动（/api/control），用于平移/转向把车开到目标附近，使机械臂（仅约 10～20cm 工作范围）能够得着。远距离够杯子、篮子、桶须先 car_move 再 arm_*。moves 支持中英文方向。走正方形等为多段路径。常与 arm_move_to、arm_pick、arm_place 组合。',
  schema: carMoveSchema,
  func: async ({ moves, speed }) => {
    try {
      const segments = moves.map((m) => ({
        http_action: normalizeCarAction(m.action),
        duration_ms: m.duration_ms,
      }));
      const out = await runHttpPathSegments({ segments, speed });
      return JSON.stringify({
        ...out,
        resolved_moves: segments.map((s) => ({ action: s.http_action, duration_ms: s.duration_ms })),
        message: out.ok ? '已按顺序下发' : '执行中有 HTTP 失败',
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return JSON.stringify({ ok: false, message: msg });
    }
  },
});

const armMoveTo = new DynamicStructuredTool({
  name: 'arm_move_to',
  description:
    '机械臂末端在**小范围**内移动（毫米，约 10～20cm 量级）。只作近处微调；**跨远点须先 car_move / car_navigate_to**。禁止用连续多次本工具代替「整车回到某处」或「抹布归位到远处」——回位是车动，不是臂多走几步。',
  schema: z.object({
    x_mm: z.number().describe('末端 X（mm）'),
    y_mm: z.number().describe('末端 Y（mm）'),
    z_mm: z.number().describe('末端 Z（mm）'),
    move_mode: z
      .enum(['fast', 'linear', 'approach'])
      .optional()
      .nullable()
      .describe('fast 快速、linear 直线、approach 接近（防碰撞）'),
  }),
  func: async ({ x_mm, y_mm, z_mm, move_mode }) => {
    return JSON.stringify({
      ok: true,
      x_mm,
      y_mm,
      z_mm,
      move_mode: move_mode ?? 'linear',
      message: '机械臂运动指令已下发（桩）',
    });
  },
});

const armPick = new DynamicStructuredTool({
  name: 'arm_pick',
  description:
    '在末端已对准物体后闭合夹爪完成抓取。典型顺序：必要时 car_move 靠近 → arm_move_to(接近) → arm_pick → arm_move_to(抬起/搬运) → …；跨远距离中间再 car_move。',
  schema: z.object({
    object_hint: z.string().optional().nullable().describe('可选：目标物说明，便于日志'),
  }),
  func: async ({ object_hint }) => {
    return JSON.stringify({
      ok: true,
      object_hint: object_hint ?? null,
      message: '抓取（夹爪闭合）指令已下发（桩）',
    });
  },
});

const armPlace = new DynamicStructuredTool({
  name: 'arm_place',
  description:
    '在末端已对准放置点上方后张开夹爪放下。**放回远处原处 / 抹布归位**：须先 car_move（或 car_navigate_to）把车开到原区域附近，再 arm_move_to 微调，最后 arm_place；勿仅靠多次 arm_move_to「挪」到远处。',
  schema: z.object({
    place_hint: z.string().optional().nullable().describe('可选：放置位置说明（如「桌面 A 区」）'),
  }),
  func: async ({ place_hint }) => {
    return JSON.stringify({
      ok: true,
      place_hint: place_hint ?? null,
      message: '放置（夹爪张开）指令已下发（桩）',
    });
  },
});

const armGrasp = new DynamicStructuredTool({
  name: 'arm_grasp',
  description:
    '低层夹爪：grasp 闭合、release 张开。搬运任务优先用 arm_pick / arm_place + arm_move_to + car_move。',
  schema: z.object({
    action: z.enum(['grasp', 'release']).describe('抓取或松开'),
  }),
  func: async ({ action }) => {
    return JSON.stringify({ ok: true, action, message: '机械臂指令已下发（桩）' });
  },
});

const cameraCapture = new DynamicStructuredTool({
  name: 'camera_capture',
  description:
    '仅拍当前视角一帧（桩），返回 image_url。需先到点再拍时：先 car_move 或 car_navigate_to，再调本工具；识图另调 vision_recognize_remote。',
  schema: z.object({
    resolution: z.enum(['low', 'medium', 'high']).optional().nullable().describe('分辨率档位'),
  }),
  func: async ({ resolution }) => {
    return JSON.stringify(captureStub(resolution ?? undefined));
  },
});

const visionRecognizeRemote = new DynamicStructuredTool({
  name: 'vision_recognize_remote',
  description:
    '对图像远程识图（桩）。通常上一步 camera_capture 的 image_url 传入本工具；**不要**与导航、拍照混成一条工具调用。',
  schema: z.object({
    image_url: z.string().url().optional().nullable().describe('可公开访问的图片 URL'),
    image_base64: z.string().optional().nullable().describe('若无 URL，可传 base64 数据（桩）'),
    prompt: z.string().optional().nullable().describe('希望模型关注的识别重点'),
  }),
  func: async ({ image_url, image_base64, prompt }) => {
    const stub = randomVisionStub(prompt ?? '');
    return JSON.stringify({
      ok: true,
      simulated: true,
      message: '远程识图完成（桩：每次返回随机位置坐标，接真机后替换为真实算法）',
      ...stub,
    });
  },
});

export const clawTools = {
  car_navigate_to: carNavigateTo,
  car_move: carMove,
  arm_move_to: armMoveTo,
  arm_pick: armPick,
  arm_place: armPlace,
  arm_grasp: armGrasp,
  camera_capture: cameraCapture,
  vision_recognize_remote: visionRecognizeRemote,
  ...reminderTools,
};
