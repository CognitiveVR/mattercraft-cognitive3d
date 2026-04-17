import { Component, Behavior, ContextManager, useOnBeforeRender, started } from "@zcomponent/core";
import { OnBeforeRenderPriority } from "@zcomponent/three";
import * as THREE from "three";

// Import the context and the interface
import { Cognitive3DContext, IDynamicObjectBehavior } from "./Cognitive3DContext";

// Reusable vector to avoid per-frame allocation in onUpdate()
const _vec = new THREE.Vector3();

export interface Cognitive3DDynamicObjectConstructionProps {
    /**
     * @zui
     * @zlabel Model Mesh Name (must match the uploaded object mesh name of Cognitive3d Dashboard)
     */
    c3dMeshName?: string;

    /**
     * @zui
     * @zlabel Custom ID (must be unique for each object)
     */
    c3dCustomId?: string;

    /**
     * @zui
     * @zdefault 0.1
     */
    positionThreshold: number;

    /**
     * @zui
     * @zdefault 0.1
     */
    rotationThreshold: number;
}

/**
 * @zbehavior
 * @zdescription Marks an object for Cognitive3D Tracking & Movement
 * @ztag three/Object3D/Analytics/Cognitive3DDynamicObject
 * @zparents three/Object3D/**
 * @zicon track_changes
 */
export class Cognitive3DDynamicObject extends Behavior<Component> implements IDynamicObjectBehavior {

    private _isInitialized = false;
    private _lastTrackedUUID: string | null = null;
    private ctx: Cognitive3DContext;

    constructor(contextManager: ContextManager, instance: Component, protected constructorProps: Cognitive3DDynamicObjectConstructionProps) {
        super(contextManager, instance);

        this.ctx = this.contextManager.get(Cognitive3DContext);

        this.register(
            useOnBeforeRender(this.contextManager),
            (_dt: number) => this.onUpdate(),
            OnBeforeRenderPriority.AfterTransforms
        );

        this.tryRegisterWithManager();
    }

    private tryRegisterWithManager() {
        if (this.ctx.registerDynamicObject) {
            started(this.contextManager).then(() => {
                this.ctx.registerDynamicObject?.(this);
            });
        } else {
            // Manager not ready yet; queue for pickup on Cognitive3D initialization
            if (!this.ctx.pendingRegistrations.includes(this)) {
                this.ctx.pendingRegistrations.push(this);
            }
        }
    }

    /**
     * Generates a stable, deterministic ID namespaced by scene name, keyed on
     * the mesh name, and disambiguated by the per-instance ZComponent entity
     * path and world position.
     *
     * When the same ZComponent is placed multiple times in a scene all instances
     * share the same c3dMeshName, so the hash must include something that varies
     * per placement. Walking the ZComponent parent chain via idByElement gives
     * the outer entity IDs (unique per placement in the parent scene). World
     * position is appended as a tiebreaker for use outside a ZComponent.
     *
     * The inspector value always takes priority — this only runs when
     * c3dCustomId is left blank.
     */
    private _generateDeterministicId(meshName: string, obj: THREE.Object3D): string {
        // ES2015-compatible left-pad (String.padStart is ES2017)
        const pad = (s: string, len: number): string => {
            while (s.length < len) s = '0' + s;
            return s;
        };

        const sceneName = this.ctx.sceneName || 'scene';
        const instancePath = this._collectInstancePath().join('/');
        const posKey = this._positionFingerprint(obj);
        const uniqueKey = (instancePath || obj.uuid) + '|' + posKey;
        const fullKey = sceneName + '::' + meshName + '::' + uniqueKey;

        // djb2 hash — simple, fast, good distribution for short strings.
        const djb2 = (input: string): number => {
            let h = 5381;
            for (let i = 0; i < input.length; i++) {
                h = Math.imul(h, 33) + input.charCodeAt(i);
                h = h | 0;
            }
            return h >>> 0;
        };

        const keyHash  = pad(djb2(fullKey).toString(16), 8);
        const nameHash = pad(djb2(uniqueKey).toString(16), 4);
        const keyLen   = pad(fullKey.length.toString(16), 4);

        return 'c3d-' + keyHash + '-' + nameHash + '-' + keyLen;
    }

    /**
     * Walks the ZComponent parent chain and collects the node IDs that each
     * ancestor is registered under in its owning ZComponent. For a behavior
     * entity placed inside a nested ZComponent, this produces a path containing
     * both the inner template-scoped ID (same for every instance) and the outer
     * placement ID (unique per instance in the parent scene). Joining them with
     * '/' gives a string that differs for each distinct placement.
     */
    private _collectInstancePath(): string[] {
        const path: string[] = [];
        const seen = new Set<string>();
        // @ts-ignore — .parent is not in public typedefs but exists at runtime
        let current: any = this.instance;
        while (current) {
            try {
                const zc = current.getZComponentInstance?.();
                if (zc?.idByElement && current.element) {
                    const entityId = zc.idByElement.get(current.element);
                    if (entityId && !seen.has(entityId)) {
                        seen.add(entityId);
                        path.push(entityId);
                    }
                }
            } catch (_) { /* keep walking */ }
            current = current.parent;
        }
        return path;
    }

    /**
     * Returns a deterministic world-position string rounded to 3 decimal places.
     * Used as a tiebreaker when _collectInstancePath returns nothing.
     */
    private _positionFingerprint(obj: THREE.Object3D): string {
        obj.updateWorldMatrix(true, false);
        const p = new THREE.Vector3();
        obj.getWorldPosition(p);
        const round = (n: number) => (Math.round(n * 1000) / 1000).toFixed(3);
        return round(p.x) + ',' + round(p.y) + ',' + round(p.z);
    }

    public getTrackedObject(): THREE.Object3D | null {
        let obj = this.instance.element as THREE.Object3D;

        if (!obj && this.instance.elementsResolved && this.instance.elementsResolved.length > 0) {
            obj = this.instance.elementsResolved[0] as THREE.Object3D;
        }

        if (obj) {
            if (!this._isInitialized) {

                // STEP 1 — Resolve mesh name first, before anything else.
                // Auto-populate from the Three.js node name if the inspector
                // field was left blank.
                if (!this.constructorProps.c3dMeshName && obj.name) {
                    this.constructorProps.c3dMeshName = obj.name;
                }

                // STEP 2 — Apply the mesh name to the Three.js object immediately
                // so obj.name is correct before the deterministic ID is hashed.
                // Previously this happened at the bottom of the block, so the hash
                // ran against an empty obj.name for unnamed AttachmentPoints,
                // causing all such objects to produce the same ID.
                if (this.constructorProps.c3dMeshName) {
                    obj.name = this.constructorProps.c3dMeshName;
                }

                // STEP 3 — Generate deterministic ID using the now-resolved mesh name.
                // Only runs when c3dCustomId was left blank in the inspector.
                if (!this.constructorProps.c3dCustomId) {
                    const meshNameForId = this.constructorProps.c3dMeshName || obj.name;
                    this.constructorProps.c3dCustomId = this._generateDeterministicId(meshNameForId, obj);
                    this.ctx.debug(
                        'Cognitive3D: Auto-generated deterministic ID for \'' + meshNameForId + '\': ' +
                        this.constructorProps.c3dCustomId + '\n' +
                        '  → To make this permanent and rename-safe, paste this value into the \'Custom ID\' inspector field.'
                    );
                }

                // STEP 4 — Set userData now that name and ID are both resolved.
                const fallbackName = obj.name || "UnnamedObject";

                obj.userData.isDynamic = true;
                obj.userData.modelId = this.constructorProps.c3dMeshName || fallbackName;
                obj.userData.positionThreshold = this.constructorProps.positionThreshold;
                obj.userData.rotationThreshold = this.constructorProps.rotationThreshold;

                if (!obj.name) {
                    console.warn(`Cognitive3D: Object with Model '${this.constructorProps.c3dMeshName}' has no name.`);
                }

                this._isInitialized = true;
            }
            return obj;
        }

        return null;
    }

    private onUpdate() {
        const obj = this.getTrackedObject();
        if (!obj) return;

        obj.getWorldPosition(_vec);

        if (obj.uuid !== this._lastTrackedUUID) {
            this._lastTrackedUUID = obj.uuid;
            this.tryRegisterWithManager();
        }
    }

    public getProps() {
        return this.constructorProps;
    }

    public override dispose() {
        // Remove from pending queue if not yet picked up by the manager
        const idx = this.ctx.pendingRegistrations.indexOf(this);
        if (idx !== -1) this.ctx.pendingRegistrations.splice(idx, 1);

        // Remove this specific instance from the manager's registry to prevent memory leaks
        this.ctx.trackedBehaviors.delete(this);
        this.ctx.registeredWithSDK.delete(this);

        return super.dispose();
    }
}
