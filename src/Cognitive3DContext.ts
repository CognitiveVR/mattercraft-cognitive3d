import { Context, ContextManager, Event } from "@zcomponent/core";
import * as THREE from "three";

export interface IDynamicObjectBehavior {
    getTrackedObject(): THREE.Object3D | null;
    getProps(): any;
}

interface Cognitive3DContextProps {}

/** @zcontext */
export class Cognitive3DContext extends Context<Cognitive3DContextProps> {

    public c3d: any | null = null;
    public c3dAdapter: any = null;
    public trackedBehaviors: Set<IDynamicObjectBehavior> = new Set();
    public registeredWithSDK: Set<IDynamicObjectBehavior> = new Set();
    public pendingRegistrations: IDynamicObjectBehavior[] = [];
    public sceneName: string = "";
    public enableDebug: boolean = false;
    public roomCaptureEnabled: boolean = false;
    public fixationsEnabled: boolean = false;
    public remoteVariablesReady: boolean = false;
    public onRemoteVariablesAvailable: Event<[]> = new Event();

    /** Set by the Cognitive3D behavior so DynamicObjects can trigger full SDK registration. */
    public registerDynamicObject: ((behavior: IDynamicObjectBehavior) => void) | null = null;

    constructor(contextManager: ContextManager, constructorProps: Cognitive3DContextProps) {
        super(contextManager, constructorProps);
    }

    public debug(...args: any[]): void {
        if (this.enableDebug) {
            console.log(...args);
        }
    }

    public recordSensor(name: string, value: number | boolean): void {
        if (!this.c3d || !this.c3d.isSessionActive()) return;
        this.c3d.sensor.recordSensor(name, value);
    }

    public sendEvent(
        category: string,
        position: number[] = [0, 0, 0],
        properties?: Record<string, any>
    ): void {
        if (!this.c3d || !this.c3d.isSessionActive()) return;
        this.c3d.customEvent.send(category, position, properties);
    }

    public getRemoteVariable<T>(name: string, defaultValue: T): T {
        const remote = this.c3d && this.c3d.remoteVariables;
        if (!remote || typeof remote.getValue !== "function") return defaultValue;
        try {
            return remote.getValue(name, defaultValue) as T;
        } catch (e) {
            return defaultValue;
        }
    }

    public listRemoteVariables(): any[] {
        const remote = this.c3d && this.c3d.remoteVariables;
        if (!remote || typeof remote.listAllVariables !== "function") return [];
        try {
            return remote.listAllVariables();
        } catch (e) {
            return [];
        }
    }

    public fetchRemoteVariables(identifier?: string): Promise<boolean> {
        const remote = this.c3d && this.c3d.remoteVariables;
        if (!remote || typeof remote.fetchVariables !== "function") return Promise.resolve(false);
        try {
            return Promise.resolve(remote.fetchVariables(identifier));
        } catch (e) {
            return Promise.resolve(false);
        }
    }

    dispose() {
        this.c3d = null;
        this.c3dAdapter = null;
        this.trackedBehaviors.clear();
        this.registeredWithSDK.clear();
        this.pendingRegistrations = [];
        this.roomCaptureEnabled = false;
        this.fixationsEnabled = false;
        this.remoteVariablesReady = false;
        this.onRemoteVariablesAvailable.clearListeners();
        return super.dispose();
    }
}
