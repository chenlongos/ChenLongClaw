/**
 * 小车 / 机械臂 / 摄像头 / 远程识图 —— 桩实现；终端打印由 weixin-claw / repl 的 onToolEnd 统一格式输出
 */
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

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
    '小车导航到地图/场地中的目标位姿（米）。用于「先开到物体旁」或「开到放置点旁」。常与 arm_move_to、arm_pick、arm_place 组合完成搬运。',
  schema: z.object({
    target_x_m: z.number().describe('目标 X（米，与现场坐标系一致）'),
    target_y_m: z.number().describe('目标 Y（米）'),
    theta_deg: z.number().optional().nullable().describe('到达后车头朝向（度），省略则由规划器决定'),
  }),
  func: async ({ target_x_m, target_y_m, theta_deg }) => {
    return JSON.stringify({
      ok: true,
      target_x_m,
      target_y_m,
      theta_deg: theta_deg ?? null,
      message: '小车导航指令已下发（桩）',
    });
  },
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
    return JSON.stringify({ ok: true, direction, duration_ms: ms, message: '小车指令已下发（桩）' });
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
  description: '从车载/机械臂摄像头采集一帧图像，返回占位 URL 或 base64（桩）。',
  schema: z.object({
    resolution: z.enum(['low', 'medium', 'high']).optional().nullable().describe('分辨率档位'),
  }),
  func: async ({ resolution }) => {
    const res = resolution ?? 'medium';
    const stubUrl = `https://example.invalid/claw/capture?res=${res}&t=${Date.now()}`;
    return JSON.stringify({
      ok: true,
      resolution: res,
      image_url: stubUrl,
      message: '已获取图像（桩，未接真实摄像头）',
    });
  },
});

const visionRecognizeRemote = new DynamicStructuredTool({
  name: 'vision_recognize_remote',
  description:
    '将图像送到远程视觉服务识别（如已有 image_url 或上一工具返回的地址）。返回是否识别到目标、置信度与目标在画面中的位置（用于导航/抓取）。',
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
  arm_move_to: armMoveTo,
  arm_pick: armPick,
  arm_place: armPlace,
  car_move: carMove,
  arm_grasp: armGrasp,
  camera_capture: cameraCapture,
  vision_recognize_remote: visionRecognizeRemote,
};
