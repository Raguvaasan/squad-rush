import * as THREE from 'three';
import { BALANCE } from '../game/balance';
import { soldierOffset, squadRadius } from '../game/formation';
import { gateLabel, isGoodGate } from '../game/gates';
import type { Enemy, GameState, Gate, GateRow } from '../game/types';

// Sim coordinates: x across the road, z forward. Three.js looks down -z, so world z = -sim z.

const MAX_PER_KIND = 128;
const MAX_BULLETS = 512;
const ROAD_LENGTH = 260;
const DASH_GAP = 4;
const DASH_COUNT = 70;
const SKY = '#9fd3ff';

type SmallKind = 'grunt' | 'brute' | 'crate';

interface GateSideView {
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  material: THREE.MeshBasicMaterial;
}

interface GateView {
  group: THREE.Group;
  sides: [GateSideView, GateSideView];
  version: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export class GameRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
  private readonly world = new THREE.Group();
  private readonly dummy = new THREE.Object3D();
  private readonly offset = { x: 0, z: 0 };
  private readonly projected = new THREE.Vector3();
  private readonly soldiers: THREE.InstancedMesh;
  private readonly enemies: Record<SmallKind, THREE.InstancedMesh>;
  private readonly boss: THREE.Mesh;
  private readonly bullets: THREE.InstancedMesh;
  private readonly dashes: THREE.InstancedMesh;
  private readonly gates = new Map<number, GateView>();
  private readonly gateGeometry = new THREE.PlaneGeometry(BALANCE.roadHalfWidth - 0.15, 2.2);
  private camDistance = 12;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, 45, 120);
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#b08a5a', 2.4));
    const sun = new THREE.DirectionalLight('#ffffff', 1.8);
    sun.position.set(4, 10, 6);
    this.scene.add(sun);

    this.buildRoad();
    this.dashes = instanced(new THREE.BoxGeometry(0.12, 0.02, 1.6), '#f4f1e8', DASH_COUNT);
    this.soldiers = instanced(footed(new THREE.CapsuleGeometry(0.13, 0.3, 4, 8)), '#2f7bff', BALANCE.maxRenderedSoldiers);
    this.enemies = {
      grunt: instanced(footed(new THREE.BoxGeometry(0.55, 0.95, 0.55)), '#5fae4f', MAX_PER_KIND),
      brute: instanced(footed(new THREE.BoxGeometry(1.1, 1.6, 1.1)), '#8e3b2e', MAX_PER_KIND),
      crate: instanced(footed(new THREE.CylinderGeometry(0.45, 0.45, 1, 14)), '#ff9f1c', MAX_PER_KIND),
    };
    this.boss = new THREE.Mesh(footed(new THREE.BoxGeometry(2.8, 3.4, 2.8)), new THREE.MeshLambertMaterial({ color: '#7b2cbf' }));
    this.boss.visible = false;
    const bulletMaterial = new THREE.MeshBasicMaterial({ color: '#ffe14d' });
    this.bullets = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 6, 4), bulletMaterial, MAX_BULLETS);
    this.bullets.frustumCulled = false;

    this.scene.add(this.world, this.dashes, this.soldiers, this.bullets, this.boss, ...Object.values(this.enemies));
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    // On narrow (portrait) screens, pull the camera back until the whole road fits.
    const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    this.camDistance = Math.max(12, (BALANCE.roadHalfWidth + 0.8) / (tanHalfFov * this.camera.aspect));
    this.camera.updateProjectionMatrix();
  }

  sync(s: GameState, time: number): void {
    const camX = s.x * 0.35;
    this.camera.position.set(camX, this.camDistance * 0.72, -s.z + this.camDistance * 0.68);
    this.camera.lookAt(camX, 0, -s.z - 7);
    this.world.position.z = -s.z;

    const dashBase = Math.floor(s.z / DASH_GAP) * DASH_GAP - 12;
    for (let k = 0; k < DASH_COUNT; k++) this.put(this.dashes, k, 0, 0.01, dashBase + k * DASH_GAP);
    finish(this.dashes, DASH_COUNT);

    this.syncSoldiers(s, time);
    this.syncEnemies(s.enemies, time);

    const bulletCount = Math.min(s.bullets.length, MAX_BULLETS);
    for (let i = 0; i < bulletCount; i++) {
      const b = s.bullets[i]!;
      this.put(this.bullets, i, b.x, 0.45, b.z);
    }
    finish(this.bullets, bulletCount);

    this.syncGates(s.gateRows);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  /** Where a sim-space point lands on screen, in CSS pixels. Used to pin DOM labels over the squad. */
  screenPosition(x: number, y: number, z: number): ScreenPoint {
    const canvas = this.renderer.domElement;
    this.projected.set(x, y, -z).project(this.camera);
    return {
      x: ((this.projected.x + 1) / 2) * canvas.clientWidth,
      y: ((1 - this.projected.y) / 2) * canvas.clientHeight,
    };
  }

  private buildRoad(): void {
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(BALANCE.roadHalfWidth * 2 + 0.4, ROAD_LENGTH),
      new THREE.MeshLambertMaterial({ color: '#5b6270' }),
    );
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(240, ROAD_LENGTH), new THREE.MeshLambertMaterial({ color: '#e2c48d' }));
    for (const plane of [road, ground]) {
      plane.rotation.x = -Math.PI / 2;
      plane.position.z = -ROAD_LENGTH / 2 + 30;
    }
    ground.position.y = -0.02;

    const curbGeometry = new THREE.BoxGeometry(0.3, 0.25, ROAD_LENGTH);
    const curbMaterial = new THREE.MeshLambertMaterial({ color: '#efe9da' });
    for (const side of [-1, 1]) {
      const curb = new THREE.Mesh(curbGeometry, curbMaterial);
      curb.position.set(side * (BALANCE.roadHalfWidth + 0.2), 0.12, road.position.z);
      this.world.add(curb);
    }
    this.world.add(road, ground);
  }

  private syncSoldiers(s: GameState, time: number): void {
    const shown = Math.min(s.squad, BALANCE.maxRenderedSoldiers);
    const radius = squadRadius(s.squad);
    for (let i = 0; i < shown; i++) {
      soldierOffset(i, shown, radius, this.offset);
      const bob = Math.abs(Math.sin(time * 12 + i * 1.7)) * 0.08;
      this.put(this.soldiers, i, s.x + this.offset.x, bob, s.z + this.offset.z);
    }
    finish(this.soldiers, shown);
  }

  private syncEnemies(enemies: Enemy[], time: number): void {
    const counts: Record<SmallKind, number> = { grunt: 0, brute: 0, crate: 0 };
    let boss: Enemy | undefined;
    for (const e of enemies) {
      if (e.kind === 'boss') {
        boss = e;
        continue;
      }
      const i = counts[e.kind]++;
      if (i >= MAX_PER_KIND) continue;
      const tilt = e.active && e.kind !== 'crate' ? Math.sin(time * 9 + e.id) * 0.12 : 0;
      this.put(this.enemies[e.kind], i, e.x, 0, e.z, tilt);
    }
    for (const kind of ['grunt', 'brute', 'crate'] as const) {
      finish(this.enemies[kind], Math.min(counts[kind], MAX_PER_KIND));
    }

    this.boss.visible = boss !== undefined;
    if (boss) {
      this.boss.position.set(boss.x, 0, -boss.z);
      this.boss.rotation.z = boss.active ? Math.sin(time * 4) * 0.05 : 0;
    }
  }

  private syncGates(rows: GateRow[]): void {
    const live = new Set<number>();
    for (const row of rows) {
      live.add(row.id);
      let view = this.gates.get(row.id);
      if (!view) {
        view = this.createGate(row);
        this.gates.set(row.id, view);
      }
      if (view.version !== row.version) {
        paintGate(view.sides[0], row.left, row.taken === 'right');
        paintGate(view.sides[1], row.right, row.taken === 'left');
        view.version = row.version;
      }
    }
    for (const [id, view] of this.gates) {
      if (live.has(id)) continue;
      this.scene.remove(view.group);
      for (const side of view.sides) {
        side.texture.dispose();
        side.material.dispose();
      }
      this.gates.delete(id);
    }
  }

  private createGate(row: GateRow): GateView {
    const group = new THREE.Group();
    group.position.z = -row.z;
    const sides = [-1, 1].map((dir) => {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 160;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('2D canvas unavailable');
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide });
      const panel = new THREE.Mesh(this.gateGeometry, material);
      panel.position.set((dir * BALANCE.roadHalfWidth) / 2, 1.3, 0);
      group.add(panel);
      return { ctx, texture, material };
    }) as [GateSideView, GateSideView];
    this.scene.add(group);
    // version -1 forces the first paint.
    return { group, sides, version: -1 };
  }

  private put(mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, tilt = 0): void {
    const d = this.dummy;
    d.position.set(x, y, -z);
    d.rotation.set(0, 0, tilt);
    d.updateMatrix();
    mesh.setMatrixAt(i, d.matrix);
  }
}

function paintGate(view: GateSideView, gate: Gate, skipped: boolean): void {
  const { ctx } = view;
  const { width, height } = ctx.canvas;
  const good = isGoodGate(gate);
  ctx.clearRect(0, 0, width, height);
  ctx.globalAlpha = skipped ? 0.25 : 1;
  ctx.fillStyle = good ? 'rgba(47, 123, 255, 0.55)' : 'rgba(255, 59, 59, 0.55)';
  ctx.strokeStyle = good ? '#9cc6ff' : '#ffb3b3';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.roundRect(6, 6, width - 12, height - 12, 18);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 84px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = 8;
  ctx.fillText(gateLabel(gate), width / 2, height / 2 + 4);
  ctx.shadowBlur = 0;
  view.texture.needsUpdate = true;
}

/** Moves a geometry up so y = 0 is its base, which keeps placement code free of half-heights. */
function footed(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  geometry.computeBoundingBox();
  geometry.translate(0, -geometry.boundingBox!.min.y, 0);
  return geometry;
}

function instanced(geometry: THREE.BufferGeometry, color: string, max: number): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshLambertMaterial({ color }), max);
  // Instances move every frame, so the precomputed bounds would be stale and cull visible meshes.
  mesh.frustumCulled = false;
  mesh.count = 0;
  return mesh;
}

function finish(mesh: THREE.InstancedMesh, count: number): void {
  mesh.count = count;
  mesh.instanceMatrix.needsUpdate = true;
}
