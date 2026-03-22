import CornellMarginalia from "../main";

// Este es el "molde" que todos los addons deben seguir
export abstract class CornellAddon {
    abstract id: string;          // El nombre interno del addon
    abstract name: string;        // El nombre bonito para el usuario
    abstract description: string; // Para qué sirve
    
    // Le pasamos el plugin principal para que pueda acceder a todo
    constructor(public plugin: CornellMarginalia) {}
    
    // Lo que hace cuando el usuario lo ENCIENDE
    abstract load(): void; 
    
    // Lo que hace cuando el usuario lo APAGA
    abstract unload(): void; 
}