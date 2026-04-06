import { Component, Behavior, ContextManager, useOnBeforeRender } from "@zcomponent/core";
import * as THREE from "three";

// Import the manager and the interface
import { Cognitive3D, IDynamicObjectBehavior } from "./Cognitive3D";

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
 */
export class Cognitive3DDynamicObject extends Behavior<Component> implements IDynamicObjectBehavior {
    
    private _isInitialized = false;
    private _lastTrackedUUID: string | null = null;

    constructor(contextManager: ContextManager, instance: Component, protected constructorProps: Cognitive3DDynamicObjectConstructionProps) {
        super(contextManager, instance);
        // @ts-ignore: TypeScript overload resolution fails for Event<[number]> but this is correct at runtime
        this.register(useOnBeforeRender(this.contextManager), () => this.onUpdate());

        this.tryRegisterWithManager();
    }

    private tryRegisterWithManager() {
        if (Cognitive3D.instance) {
            // Delay slightly to ensure Mattercraft has resolved the new AttachmentPoint's transform
            setTimeout(() => {
                Cognitive3D.instance?.registerDynamicObject(this);
            }, 100);
        } else {
            // Manager not ready yet; queue for pickup on Cognitive3D initialization
            if (!Cognitive3D.pendingRegistrations.includes(this)) {
                Cognitive3D.pendingRegistrations.push(this);
            }
        }
    }

    /**
     * Generates a stable, deterministic ID namespaced by scene name and keyed
     * on the mesh name. Mesh names must already be unique per tracked object for
     * the Cognitive3D dashboard to distinguish objects, making them a reliable
     * stable hash input.
     *
     * The parent-chain approach was avoided because Mattercraft AttachmentPoints
     * frequently have no name on themselves or their ancestors, causing all
     * unnamed objects to produce the same path string and identical IDs.
     *
     * Falls back to obj.uuid when no mesh name is available. This is unique
     * within a session but not persistent across page reloads.
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

        // Namespace by scene name so the same mesh name in different scenes
        // does not collide on the Cognitive3D dashboard.
        const sceneName = Cognitive3D.instance?.sceneName ?? 'scene';
        const uniqueKey = meshName || obj.uuid;
        const fullKey = sceneName + '::' + uniqueKey;

        // djb2 hash — simple, fast, good distribution for short strings.
        const djb2 = (input: string): number => {
            let h = 5381;
            for (let i = 0; i < input.length; i++) {
                h = Math.imul((h << 5) + h, 1) + input.charCodeAt(i);
                h = h | 0;
            }
            return h >>> 0;
        };

        const keyHash  = pad(djb2(fullKey).toString(16), 8);
        const nameHash = pad(djb2(uniqueKey).toString(16), 4);
        const keyLen   = pad(fullKey.length.toString(16), 4);

        return 'c3d-' + keyHash + '-' + nameHash + '-' + keyLen;
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
                    console.log(
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

                if (this.constructorProps.c3dMeshName) {
                    obj.name = this.constructorProps.c3dMeshName;
                }

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

        obj.updateMatrixWorld(true);

        const vec = new THREE.Vector3();
        obj.getWorldPosition(vec);

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
        const idx = Cognitive3D.pendingRegistrations.indexOf(this);
        if (idx !== -1) Cognitive3D.pendingRegistrations.splice(idx, 1);

        // Remove this specific instance from the manager's registry to prevent memory leaks
        if (Cognitive3D.instance) {
            Cognitive3D.instance.unregisterDynamicObject(this);
        }
        return super.dispose();
    }
}