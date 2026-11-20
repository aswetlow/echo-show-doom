;; Feasibility probe module (hand-written, no toolchain needed on the user's side).
;; add(a, b)      -> a + b                       (does instantiation + calls work at all?)
;; bench(n, seed) -> xorshift32 state after n steps (rough integer CPU benchmark)
;; checksum(len)  -> fills linear memory with a pattern and sums it (does linear memory work?)
(module
  (memory (export "memory") 2)
  (func (export "add") (param $a i32) (param $b i32) (result i32)
    local.get $a
    local.get $b
    i32.add)
  (func (export "bench") (param $n i32) (param $x i32) (result i32)
    (block $done
      (loop $next
        local.get $n
        i32.eqz
        br_if $done
        ;; x ^= x << 13; x ^= x >>> 17; x ^= x << 5
        local.get $x
        local.get $x
        i32.const 13
        i32.shl
        i32.xor
        local.set $x
        local.get $x
        local.get $x
        i32.const 17
        i32.shr_u
        i32.xor
        local.set $x
        local.get $x
        local.get $x
        i32.const 5
        i32.shl
        i32.xor
        local.set $x
        local.get $n
        i32.const 1
        i32.sub
        local.set $n
        br $next))
    local.get $x)
  (func (export "checksum") (param $len i32) (result i32)
    (local $i i32) (local $sum i32)
    (block $w (loop $l
      local.get $i
      local.get $len
      i32.ge_u
      br_if $w
      local.get $i
      local.get $i
      i32.const 251
      i32.rem_u
      i32.store8
      local.get $i
      i32.const 1
      i32.add
      local.set $i
      br $l))
    i32.const 0
    local.set $i
    (block $w2 (loop $l2
      local.get $i
      local.get $len
      i32.ge_u
      br_if $w2
      local.get $sum
      local.get $i
      i32.load8_u
      i32.add
      local.set $sum
      local.get $i
      i32.const 1
      i32.add
      local.set $i
      br $l2))
    local.get $sum)
)
