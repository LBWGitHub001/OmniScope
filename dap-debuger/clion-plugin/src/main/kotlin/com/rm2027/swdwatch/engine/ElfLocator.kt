package com.rm2027.swdwatch.engine

import com.intellij.execution.RunManager
import com.intellij.execution.configurations.RunProfile
import com.intellij.openapi.project.Project
import com.intellij.xdebugger.XDebugProcess
import java.io.File
import java.nio.file.Files
import java.nio.file.Path

fun locateElf(project: Project, debugProcess: XDebugProcess?): Path? {
    val base = project.basePath?.let { Path.of(it) }
    debugProcess?.session?.runProfile?.let { elfFromProfile(it, base) }?.let { return it }
    commandLineElf(debugProcess)?.let { return it }
    RunManager.getInstance(project).selectedConfiguration?.configuration?.let { elfFromProfile(it, base) }?.let { return it }
    return base?.let { newestElf(it) }
}

private fun commandLineElf(debugProcess: XDebugProcess?): Path? {
    val handler = debugProcess?.processHandler ?: return null
    val command = handler.javaClass.methods.firstOrNull { it.name == "getCommandLineString" && it.parameterCount == 0 }
        ?.let { runCatching { it.invoke(handler) as? String }.getOrNull() }
        ?: return null
    return Regex("""(?:^|\s)(\S+\.elf)""").findAll(command)
        .map { it.groupValues[1].trim('"', '\'') }
        .mapNotNull { text -> Path.of(text).takeIf { Files.isRegularFile(it) } }
        .firstOrNull()
}

private fun elfFromProfile(profile: RunProfile, base: Path?): Path? {
    existingElf(readPath(profile), base)?.let { return it }
    val data = call(profile, "getExecutableData")
    existingElf(readPath(data), base)?.let { return it }
    for (name in listOf("getProductFile", "getSelectedConfiguration", "getCMakeTarget", "getBuildTarget", "getTarget")) {
        val child = call(profile, name) ?: continue
        existingElf(readPath(child), base)?.let { return it }
        val nested = call(child, "getProductFile") ?: call(child, "getExecutableData")
        existingElf(readPath(nested), base)?.let { return it }
    }
    return null
}

private fun call(target: Any?, name: String): Any? {
    if (target == null) return null
    val method = target.javaClass.methods.firstOrNull { it.name == name && it.parameterCount == 0 } ?: return null
    return runCatching { method.invoke(target) }.getOrNull()
}

private fun readPath(target: Any?): String? {
    when (target) {
        null -> return null
        is File -> return target.path
        is Path -> return target.toString()
        is String -> return target
    }
    field(target, "path")?.let { return it }
    field(target, "myProductFile")?.let { return it }
    val text = target.toString()
    return Regex("""Path:\s*(\S+)""").find(text)?.groupValues?.get(1) ?: text.takeIf { ".elf" in it }
}

private fun field(target: Any, name: String): String? {
    var type: Class<*>? = target.javaClass
    while (type != null) {
        val found = type.declaredFields.firstOrNull { it.name == name }
        if (found != null) {
            val value = runCatching {
                found.isAccessible = true
                found.get(target)
            }.getOrNull() ?: return null
            return when (value) {
                is File -> value.path
                is Path -> value.toString()
                else -> value.toString()
            }
        }
        type = type.superclass
    }
    return null
}

private fun existingElf(text: String?, base: Path?): Path? {
    if (text.isNullOrBlank() || ".elf" !in text) return null
    val raw = Regex("""(\S+\.elf)""").find(text)?.groupValues?.get(1) ?: return null
    val direct = Path.of(raw)
    if (Files.isRegularFile(direct)) return direct
    if (base != null) {
        val relative = base.resolve(raw)
        if (Files.isRegularFile(relative)) return relative
    }
    return null
}
