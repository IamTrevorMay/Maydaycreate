// Mayday Create - ExtendScript Entry Point
// This file is the main entry when loaded by CEP

// Expose the bridge dispatcher globally for CSInterface.evalScript
function maydayCall(moduleAndFn, argsJson) {
    return MaydayBridge.callScript(moduleAndFn, argsJson);
}

// Initialization
$.writeln("Mayday Create ExtendScript loaded successfully");
