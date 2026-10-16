package com.rm2027.swdwatch.engine

private val functions = mapOf(
    "sin" to Math::sin,
    "cos" to Math::cos,
    "tan" to Math::tan,
    "abs" to Math::abs,
    "sqrt" to Math::sqrt,
)

fun compileExpr(source: String): (Double) -> Double {
    val text = source.trim()
    if (text.isEmpty()) throw IllegalArgumentException("表达式为空")
    val ast = Parser(tokenize(text)).parse()
    return { x -> ast.eval(x) }
}

private class Parser(private val tokens: List<Token>) {
    private var index = 0

    fun parse(): Node {
        val ast = parseExpr()
        if (index < tokens.size) throw IllegalArgumentException("表达式有多余内容")
        return ast
    }

    private fun peek() = tokens.getOrNull(index)

    private fun parseExpr(): Node {
        var node = parseTerm()
        while (peek()?.kind == "+" || peek()?.kind == "-") {
            val op = tokens[index++].kind
            node = Node.Binary(op, node, parseTerm())
        }
        return node
    }

    private fun parseTerm(): Node {
        var node = parsePower()
        while (true) {
            val token = peek()
            if (token?.kind == "*" || token?.kind == "/") {
                val op = tokens[index++].kind
                node = Node.Binary(op, node, parsePower())
                continue
            }
            if (token != null && token.kind in setOf("num", "id", "(")) {
                node = Node.Binary("*", node, parsePower())
                continue
            }
            break
        }
        return node
    }

    private fun parsePower(): Node {
        val node = parseUnary()
        if (peek()?.kind == "^") {
            index++
            return Node.Binary("^", node, parseUnary())
        }
        return node
    }

    private fun parseUnary(): Node {
        if (peek()?.kind == "-") {
            index++
            return Node.Neg(parseUnary())
        }
        return parsePrimary()
    }

    private fun parsePrimary(): Node {
        val token = peek() ?: throw IllegalArgumentException("表达式不完整")
        if (token.kind == "num") {
            index++
            return Node.Num(token.value)
        }
        if (token.kind == "id") {
            index++
            if (peek()?.kind == "(") {
                val fn = functions[token.text] ?: throw IllegalArgumentException("未知函数 ${token.text}")
                index++
                val arg = parseExpr()
                if (peek()?.kind != ")") throw IllegalArgumentException("缺少 )")
                index++
                return Node.Call(fn, arg)
            }
            if (token.text != "x") throw IllegalArgumentException("只认识变量 x")
            return Node.X
        }
        if (token.kind == "(") {
            index++
            val inner = parseExpr()
            if (peek()?.kind != ")") throw IllegalArgumentException("缺少 )")
            index++
            return inner
        }
        throw IllegalArgumentException("无法解析")
    }
}

private class Token(val kind: String, val text: String = "", val value: Double = 0.0)

private fun tokenize(source: String): List<Token> {
    val tokens = mutableListOf<Token>()
    var index = 0
    while (index < source.length) {
        val ch = source[index]
        if (ch == ' ' || ch == '\t') {
            index++
            continue
        }
        if (ch in "+-*/^()") {
            tokens += Token(ch.toString())
            index++
            continue
        }
        if (ch.isDigit() || ch == '.') {
            val start = index
            index++
            while (index < source.length && (source[index].isDigit() || source[index] == '.')) index++
            tokens += Token("num", value = source.substring(start, index).toDouble())
            continue
        }
        if (ch.isLetter()) {
            val start = index
            index++
            while (index < source.length && (source[index].isLetterOrDigit() || source[index] == '_')) index++
            tokens += Token("id", text = source.substring(start, index))
            continue
        }
        throw IllegalArgumentException("无法识别 $ch")
    }
    return tokens
}

private sealed class Node {
    abstract fun eval(x: Double): Double
    data class Num(val value: Double) : Node() { override fun eval(x: Double) = value }
    data object X : Node() { override fun eval(x: Double) = x }
    data class Neg(val inner: Node) : Node() { override fun eval(x: Double) = -inner.eval(x) }
    data class Call(val fn: (Double) -> Double, val arg: Node) : Node() { override fun eval(x: Double) = fn(arg.eval(x)) }
    data class Binary(val op: String, val left: Node, val right: Node) : Node() {
        override fun eval(x: Double): Double {
            val a = left.eval(x)
            val b = right.eval(x)
            return when (op) {
                "+" -> a + b
                "-" -> a - b
                "*" -> a * b
                "/" -> a / b
                "^" -> Math.pow(a, b)
                else -> error(op)
            }
        }
    }
}
