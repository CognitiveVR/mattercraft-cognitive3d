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
    private _originalY: number = 0;
    private _movePhase: number = 0;
    private _lastTrackedUUID: string | null = null;

    constructor(contextManager: ContextManager, instance: Component, protected constructorProps: Cognitive3DDynamicObjectConstructionProps) {
        super(contextManager, instance);
        
        this.register(useOnBeforeRender(this.contextManager), () => this.onUpdate());

        this.tryRegisterWithManager();
    }

    private tryRegisterWithManager() {
        if (Cognitive3D.instance) {
            // Delay slightly to ensure Mattercraft has resolved the new AttachmentPoint's transform
            setTimeout(() => {
                Cognitive3D.instance?.registerDynamicObject(this);
            }, 100);
        }
    }

    public getTrackedObject(): THREE.Object3D | null {
        let obj = this.instance.element as THREE.Object3D;

        if (!obj && this.instance.elementsResolved && this.instance.elementsResolved.length > 0) {
            obj = this.instance.elementsResolved[0] as THREE.Object3D;
        }

        if (obj) {
            if (!this._isInitialized) {
                const fallbackName = obj.name || "UnnamedObject";

                obj.userData.isDynamic = true;
                obj.userData.modelId = this.constructorProps.c3dMeshName || fallbackName;
                obj.userData.positionThreshold = this.constructorProps.positionThreshold;
                obj.userData.rotationThreshold = this.constructorProps.rotationThreshold;
                
                this._originalY = obj.position.y;
                this._movePhase = Math.random() * Math.PI * 2;

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
        // Remove this specific instance from the manager's registry to prevent memory leaks
        if (Cognitive3D.instance) {
            Cognitive3D.instance.unregisterDynamicObject(this);
        }
        return super.dispose();
    }
}