/**
 * 小车 / 机械臂 / 摄像头 / 远程识图 —— 桩实现；终端打印由 weixin-claw / repl 的 onToolEnd 统一格式输出
 */
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { reminderTools } from './reminderTools.js';

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

function navigateStub({ target_x_m, target_y_m, theta_deg }) {
  return {
    ok: true,
    target_x_m,
    target_y_m,
    theta_deg: theta_deg ?? null,
    message: '小车导航指令已下发（桩）',
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

/**
 * 组合工具：顺序在代码里写死（导航 → 拍照 → 可选识图），不依赖提示词约束。
 * 「原地拍」「只识图不传导航」仍用 camera_capture / vision_recognize_remote。
 */
const navigateObserve = new DynamicStructuredTool({
  name: 'navigate_observe',
  description:
    '开到目标位姿后立刻拍照，并可选用 vision_prompt 做识图。适用于「到某处再看有没有某物」；顺序由本工具内部保证。若用户只要当前位置拍一张、不要动车，请改用 camera_capture。',
  schema: z.object({
    target_x_m: z.number().describe('目标 X（米）'),
    target_y_m: z.number().describe('目标 Y（米）'),
    theta_deg: z.number().optional().nullable().describe('车头朝向（度）'),
    resolution: z.enum(['low', 'medium', 'high']).optional().nullable().describe('拍照分辨率'),
    vision_prompt: z
      .string()
      .optional()
      .nullable()
      .describe('非空则在拍照后执行远程识图；省略则仅导航+拍照'),
  }),
  func: async ({ target_x_m, target_y_m, theta_deg, resolution, vision_prompt }) => {
    const steps = [];
    const nav = navigateStub({ target_x_m, target_y_m, theta_deg });
    steps.push({ phase: 'navigate', result: nav });
    const cap = captureStub(resolution ?? undefined);
    steps.push({ phase: 'capture', result: cap });
    let visionResult = null;
    if (vision_prompt != null && String(vision_prompt).trim()) {
      const p = String(vision_prompt).trim();
      visionResult = {
        ok: true,
        simulated: true,
        message: '远程识图完成（桩）',
        image_url: cap.image_url,
        ...randomVisionStub(p),
      };
      steps.push({ phase: 'vision', result: visionResult });
    }
    return JSON.stringify({
      ok: true,
      chained: true,
      phases: ['navigate', 'capture', ...(visionResult ? ['vision'] : [])],
      steps,
      final_image_url: cap.image_url,
      vision: visionResult,
    });
  },
});

const carNavigateTo = new DynamicStructuredTool({
  name: 'car_navigate_to',
  description:
    '小车导航到地图/场地中的目标位姿（米）。用于「先开到物体旁」或「开到放置点旁」。常与 arm_move_to、arm_pick、arm_place 组合完成搬运。',
  schema: z.object({
    target_x_m: z.number().describe('目标 X（米，与现场坐标系一致）'),
    target_y_m: z.number().describe('目标 Y（米）'),
    theta_deg: z.number().optional().nullable().describe('到达后车头朝向（度），省略则由规划器决定'),
  }),
  func: async (args) => JSON.stringify(navigateStub(args)),
});

const armMoveTo = new DynamicStructuredTool({
  name: 'arm_move_to',
  description:
    '机械臂末端移动到指定笛卡尔位姿（毫米）。用于接近物体、抬起、移动到放置点上方等「只移动、不抓放」的步骤。',
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
    '在末端已对准物体后闭合夹爪完成抓取。典型顺序：car_navigate_to → arm_move_to(接近) → arm_pick → arm_move_to(抬起/搬运) → …',
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
    '在末端已移动到放置点上方/接触面后张开夹爪放下物体。典型顺序：…→ arm_move_to(放置点) → arm_place。与 arm_pick 成对使用完成「拿走再放下」。',
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

function carHttpBaseUrl() {
  return process.env.CAR_HTTP_BASE_URL?.trim() || 'http://172.16.203.160';
}

/** 设备约定：query 参数 time 为毫秒（ms）。例如 1 秒 → time=1000 */
async function carControlHttp({ action, speed, time_ms }) {
  const base = carHttpBaseUrl().replace(/\/+$/, '');
  const url = new URL(`${base}/api/control`);
  url.searchParams.set('action', action);
  url.searchParams.set('speed', String(speed));
  url.searchParams.set('time', String(Math.max(1, Math.round(time_ms))));
  const resp = await fetch(url.toString(), { method: 'GET' });
  const text = await resp.text().catch(() => '');
  return {
    ok: resp.ok,
    http_status: resp.status,
    url: url.toString(),
    response_text: text?.slice(0, 500) || '',
  };
}

const carControlHttpTool = new DynamicStructuredTool({
  name: 'car_control_http',
  description:
    '通过 HTTP GET 控制小车：GET /api/control?action=up|down|left|right&speed=150&time=毫秒。time 为 ms（如 1 秒填 duration_s=1 或 duration_ms=1000）。可用 CAR_HTTP_BASE_URL 覆盖小车地址。',
  schema: z.object({
    action: z.enum(['up', 'down', 'left', 'right']).describe('方向：up/down/left/right'),
    speed: z.number().int().min(0).max(255).optional().nullable().describe('速度 0~255，默认 150'),
    duration_s: z.number().positive().optional().nullable().describe('持续秒数，与 duration_ms 二选一；如 1 表示 1 秒→请求 time=1000'),
    duration_ms: z.number().int().positive().optional().nullable().describe('持续毫秒数，与 duration_s 二选一；如 1000 表示 1 秒'),
  }),
  func: async ({ action, speed, duration_s, duration_ms }) => {
    const s = speed ?? 150;
    let time_ms;
    if (duration_ms != null) {
      time_ms = duration_ms;
    } else if (duration_s != null) {
      time_ms = Math.round(duration_s * 1000);
    } else {
      time_ms = 1000;
    }
    const result = await carControlHttp({ action, speed: s, time_ms });
    return JSON.stringify({
      ...result,
      action,
      speed: s,
      time_ms,
      message: result.ok ? '小车 HTTP 控制成功' : '小车 HTTP 控制失败',
    });
  },
});

const carMove = new DynamicStructuredTool({
  name: 'car_move',
  description:
    '简易底盘运动：仅前进/后退定时长。若要「开到某坐标」请用 car_navigate_to。',
  schema: z.object({
    direction: z.enum(['forward', 'backward']).describe('行驶方向'),
    duration_ms: z
      .number()
      .int()
      .positive()
      .optional()
      .nullable()
      .describe('持续毫秒数，默认 1000'),
  }),
  func: async ({ direction, duration_ms }) => {
    const ms = duration_ms ?? 1000;
    // forward/backward → up/down；duration_ms 直接作为设备 time（毫秒）
    const action = direction === 'forward' ? 'up' : 'down';
    const result = await carControlHttp({ action, speed: 150, time_ms: ms });
    return JSON.stringify({
      ...result,
      direction,
      mapped_action: action,
      duration_ms: ms,
      message: result.ok ? '小车指令已下发（HTTP）' : '小车指令下发失败（HTTP）',
    });
  },
});

const armGrasp = new DynamicStructuredTool({
  name: 'arm_grasp',
  description:
    '低层夹爪：grasp 闭合、release 张开。搬运任务优先用 arm_pick / arm_place + arm_move_to + car_navigate_to。',
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
    '仅拍当前视角一帧（桩）。需要「先开到某处再观察」请用 navigate_observe，由程序保证顺序。',
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
    '对指定图像做远程识图（桩）。可与 camera_capture 搭配；「导航+拍+识」一条龙请用 navigate_observe。',
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
  navigate_observe: navigateObserve,
  car_navigate_to: carNavigateTo,
  arm_move_to: armMoveTo,
  arm_pick: armPick,
  arm_place: armPlace,
  car_move: carMove,
  car_control_http: carControlHttpTool,
  arm_grasp: armGrasp,
  camera_capture: cameraCapture,
  vision_recognize_remote: visionRecognizeRemote,
  ...reminderTools,
};
