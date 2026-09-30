const QUESTION_BANK = [
  {
    id: "dict-alias",
    title: "Dictionary Aliasing",
    difficulty: "Beginner",
    code: `x = {"score": 10}
y = x
y["score"] = 20
print(x["score"])`,
    expected: "20",
    concept: "Object references and mutation",
  },
  {
    id: "mutable-default",
    title: "Mutable Default Argument",
    difficulty: "Intermediate",
    code: `def add_item(item, lst=[]):
    lst.append(item)
    return lst

print(add_item("a"))
print(add_item("b"))`,
    expected: "['a']\n['a', 'b']",
    concept: "Default arguments are evaluated once at definition",
  },
  {
    id: "closure-late-binding",
    title: "Closure Late Binding",
    difficulty: "Advanced",
    code: `funcs = []
for i in range(3):
    funcs.append(lambda: i)

print([f() for f in funcs])`,
    expected: "[2, 2, 2]",
    concept: "Closures capture variables, not values",
  },
  {
    id: "list-multiplication",
    title: "List Multiplication",
    difficulty: "Intermediate",
    code: `row = [0] * 3
grid = [row] * 2
grid[0][0] = 1
print(grid)`,
    expected: "[[1, 0, 0], [1, 0, 0]]",
    concept: "Shallow copying and shared references",
  },
  {
    id: "string-immutable",
    title: "String Immutability",
    difficulty: "Beginner",
    code: `s = "hello"
s.upper()
print(s)`,
    expected: "hello",
    concept: "Strings are immutable — methods return new strings",
  },
  {
    id: "float-precision",
    title: "Float Precision",
    difficulty: "Intermediate",
    code: `print(0.1 + 0.2 == 0.3)`,
    expected: "False",
    concept: "Binary floating-point representation",
  },
  {
    id: "tuple-mutable",
    title: "Tuple with Mutable Element",
    difficulty: "Intermediate",
    code: `t = (1, [2, 3])
t[1].append(4)
print(t)`,
    expected: "(1, [2, 3, 4])",
    concept: "Tuples are immutable, but their contents may not be",
  },
  {
    id: "in-place-add",
    title: "In-place Add on Lists",
    difficulty: "Advanced",
    code: `def f(x):
    x += [1]
    return x

a = [0]
f(a)
print(a)`,
    expected: "[0, 1]",
    concept: "The += operator mutates lists in place",
  },
  {
    id: "is-vs-equals",
    title: "Identity vs Equality",
    difficulty: "Beginner",
    code: `a = [1, 2, 3]
b = [1, 2, 3]
print(a == b)
print(a is b)`,
    expected: "True\nFalse",
    concept: "== compares values, is compares identity",
  },
  {
    id: "scope-global",
    title: "Modifying Outer Scope",
    difficulty: "Advanced",
    code: `count = 0

def increment():
    count += 1

increment()
print(count)`,
    expected: "UnboundLocalError",
    concept: "Assignment inside a function creates a local variable",
  },
];

function getRandomQuestion() {
  return QUESTION_BANK[Math.floor(Math.random() * QUESTION_BANK.length)];
}
