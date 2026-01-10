---
title: Renormalization Group (RG) Theory Notes
author: Jarred Barber
date: 12/15/2025
---

**Goal**: Derive simple RG flows to demonstrate how coarse-graining leads to effective Hamiltonians and fixed points.

## Plan

1. **Conceptual Intro**: What is RG? (Coarse-graining + Rescaling). The "Block Spin" idea (Kadanoff).
2. **The Simple Case (1D Ising Model)**:
    * Exact decimation (summing over every other spin).
    * Derive the recursion relation for coupling $K$.
    * Analyze fixed points ($T=0$ and $T=\infty$).
    * Conclusion: No phase transition in 1D at finite T.
3. **The Slightly Non-Trivial Case (Approximation for 2D)**:
    * Why exact 2D is hard.
    * **Migdal-Kadanoff / Hierarchical Lattice**: Solving the "Diamond" unit cell.
    * Uses 1D intuition (Series/Parallel bonds).
    * Derive $x' = f(x)$.
    * Show a non-trivial fixed point $x^*$. (Phase Transition!).
4. **Discussion**: Universality and critical exponents.

---

## 0. Conceptual Intro: The Philosophy of RG

**The Core Idea**: Physics often looks different at different scales.

* At the atomic scale, we see water molecules bumping around.
* At the human scale, we see hydrodynamics (Navier-Stokes).
**RG is the mathematical bridge** between these scales. It tells us how the parameters of our theory (like coupling constants $K \propto 1/T$) change as we "zoom out".

### The 3 Steps of RG (Kadanoff Block Spins)

1. **Coarse Grain**: Group microscopic degrees of freedom into blocks (e.g., small clusters of spins).
2. **Decimate/Average**: Replace the block with a single "effective" spin (using a rule like "majority wins" or tracing out valid configurations).
3. **Rescale**: Rescale distances so the new lattice looks like the original one.

### Why do we do this?

* **The Flow**: Repeating this operation creates a "flow" in the parameter space ($K \to K' \to K''$).
* **Fixed Points**: Where the flow stops changing ($K' = K$). This represents a state that is **Scale Invariant** (looks the same at all zooms).
* **Universality**: Many different microscopic systems flow to the *same* fixed point. This explains why a liquid-gas transition and a magnetic transition can have the exact same critical exponents!

---

## 1. The Simple Case: 1D Ising Model (Exact Decimation)

We start with a 1D chain of $N$ spins with nearest-neighbor interactions.
Hamiltonian (in units of $k_B T$, so we work with reduced coupling $K = J/k_B T$):

$$ -\beta H = K \sum_i \sigma_i \sigma_{i+1} $$

**Partition Function:**
The partition function is the sum over all possible spin configurations $\{\sigma_i\}$:
$$ Z_N = \sum_{\sigma_1} \sum_{\sigma_2} \dots \sum_{\sigma_N} \exp\left( K \sum_i \sigma_i \sigma_{i+1} \right) $$

### The Decimation Step: Removing Odd Spins

We want to remove (trace out) every **odd** spin (e.g., $\sigma_2$) to leave an effective interaction between its neighbors ($\sigma_1$ and $\sigma_3$).
The goal is to map the original system of $N$ spins and coupling $K$ to a new system of $N/2$ spins with a new coupling $K'$.

Consider a specific term involving spin $\sigma_2$:
$$ \dots + K \sigma_1 \sigma_2 + K \sigma_2 \sigma_3 + \dots $$

To "integrate out" $\sigma_2$, we sum over its possible values ($\pm 1$):
$$ \sum_{\sigma_2 = \pm 1} e^{K \sigma_2 (\sigma_1 + \sigma_3)} = e^{K(\sigma_1 + \sigma_3)} + e^{-K(\sigma_1 + \sigma_3)} $$

Let's evaluate this expression for the two possible relative orientations of the neighbors $\sigma_1$ and $\sigma_3$:

1. **Ferromagnetic alignment** ($\sigma_1 = \sigma_3$):
    $$ e^{2K} + e^{-2K} = 2 \cosh(2K) $$
2. **Anti-ferromagnetic alignment** ($\sigma_1 = -\sigma_3$):
    $$ e^{0} + e^{0} = 2 $$

Now, we demand that the remaining spins interact via a standard Ising interaction with a *new* coupling $K'$ and a constant prefactor $C'$:
$$ e^{K' \sigma_1 \sigma_3 + g} = C' e^{K' \sigma_1 \sigma_3} $$
Evaluating this for the same two cases:

1. **Aligned** ($\sigma_1 \sigma_3 = 1$): $C' e^{K'}$
2. **Anti-aligned** ($\sigma_1 \sigma_3 = -1$): $C' e^{-K'}$

### Solving for the Recursion Relation $K \to K'$

We match the physical results with our ansatz:

1. $C' e^{K'} = 2 \cosh(2K)$
2. $C' e^{-K'} = 2$

By dividing equation (1) by equation (2), we eliminate $C'$:
$$ \frac{e^{K'}}{e^{-K'}} = e^{2K'} = \cosh(2K) $$
$$ K' = \frac{1}{2} \ln(\cosh(2K)) $$

This equation tells us exactly how the effective "temperature" (inverse coupling) changes as we zoom out.

### Analyzing the Flow with $x = \tanh K$

The function $\ln(\cosh(2K))$ is a bit opaque. A clever change of variables simplifies the math immensely.
Let $x = \tanh K$. Note that:

* $T \to 0 \implies K \to \infty \implies x \to 1$.
* $T \to \infty \implies K \to 0 \implies x \to 0$.

Using the identity $e^{2K} = \frac{1+x}{1-x}$, one can show the recursion relation becomes simply:
$$ x' = x^2 $$

**Visualizing the RG Flow**:

* If we start with $x = 0.9$ (low temp), the next iteration is $0.81$, then $0.65$, then $0.43$... continually decreasing towards 0.
* **Stable Fixed Point**: $x^* = 0$ (High Temperature / Disordered). The "sink" of the flow.
* **Unstable Fixed Point**: $x^* = 1$ (Zero Temperature). You only stay here if you start *exactly* here.

**Physics Conclusion**: Any finite temperature ($x < 1$) eventually flows to the disordered state ($x=0$). This proves there is no spontaneous magnetization (no phase transition) in the 1D Ising model at $T > 0$.

---

## 2. A Slightly Non-Trivial Case: The Hierarchical Lattice (Migdal-Kadanoff)

The 1D case was boring because there was no phase transition. We need a model that competes "order" (coupling) against "disorder" (entropy) more effectively.
The **Hierarchical Lattice** (often called the Diamond Lattice) is a toy model that mimics 2D behavior and can be solved exactly.

### Imposing the "Diamond" Geometry

Imagine replacing every single bond in the lattice with a 4-bond "diamond" structure:

* Start with clear bond $A-B$.
* Replace it with two parallel branches.
* Each branch has 2 bonds in series.
* This introduces 2 new "internal" spins, $\sigma_1$ and $\sigma_2$.

**The Renormalization Step**:
We want to integrate out $\sigma_1$ and $\sigma_2$ to squash the diamond back into a single bond between $A$ and $B$, finding the new effective coupling $K'$.

### Step-by-Step Derivation using $x = \tanh K$

We can build the solution using two basic rules for combining bonds:

1. **Series Rule (Decimation)**:
    Just like in 1D, if we have two bonds $K$ in a line ($A - \sigma_1 - B$), integrating out the middle spin creates a weaker effective bond.
    From Section 1, we know:
    $$ x_{series} = x^2 $$
    * (Intuition: $x < 1$, so squaring it makes it smaller. Correlations decay over distance.)

2. **Parallel Rule (Bond Addition)**:
    If we have two bonds connecting the same two spins ($A$ and $B$), the energies just add up:
    $$ -\beta H_{total} = (K_1 + K_2) \sigma_A \sigma_B $$
    So $K_{new} = K_1 + K_2$.
    In terms of $x = \tanh K$, the addition formula for hyperbolic tangents is:
    $$ x_{parallel} = \tanh(K_1 + K_2) = \frac{x_1 + x_2}{1 + x_1 x_2} $$
    For two identical bonds ($x_1=x_2=x$):
    $$ x_{parallel} = \frac{2x}{1 + x^2} $$
    * (Intuition: Adding bonds strengthens the connection, pushing $x$ closer to 1).

**Combining Them**:
The diamond unit cell has 2 branches in parallel. Each branch has 2 bonds in series.

1. **First, do the series** part for each branch:
    $$ x_{branch} = x^2 $$
2. **Second, do the parallel** part to combine the two branches:
    $$ x' = \frac{2(x_{branch})}{1 + (x_{branch})^2} = \frac{2x^2}{1 + x^4} $$

This is our new Recursion Relation: **$x' = R(x) = \frac{2x^2}{1 + x^4}$**.

### Analyzing the Flow: The Phase Transition

Let's find the fixed points $x^* = R(x^*)$:

1. **$x^* = 0$**: Stable sink (Disordered/High T).
2. **$x^* = 1$**: Stable sink (Ordered/Low T).
    * Wait, $x=1$ is stable now? Let's check near $x=1$: if $x = 1-\epsilon$, $R(x)$ pushes it back towards 1. Order is robust in 2D!
3. **The Critical Fixed Point ($x_c$)**:
    Set $x = \frac{2x^2}{1 + x^4}$. Divide by $x$ (assuming $x \neq 0$):
    $$ 1 = \frac{2x}{1 + x^4} \implies 1 + x^4 = 2x $$
    Rearranging: $x^4 - 2x + 1 = 0$.
    We know $x=1$ is a root. Factor out $(x-1)$:
    $$ (x-1)(x^3 + x^2 + x - 1) = 0 $$
    We need the real root of $x^3 + x^2 + x - 1 = 0$.
    Numerical solution: **$x_c \approx 0.543689$**.

**Conclusion**:

* If we start with $K$ such that $x < 0.54$, the flow goes to 0 (Disordered).
* If we start with $K$ such that $x > 0.54$, the flow goes to 1 (Ordered Ferromagnet).
* This $x_c$ corresponds to the **Curie Temperature** $T_c$. We have successfully predicted a phase transition!

## 3. Universality and Critical Exponents

Why do we care about this fixed point $x_c$?
It is **unstable**. In reality, a physical system would need to be perfectly tuned to $T_c$ to stay there.
However, **how** it leaves the fixed point tells us everything about the phase transition class.

**Linearizing the Flow**:
Near the critical point, assume $x \approx x_c + \delta x$.
The recursion relation $x' = R(x)$ becomes:
$$ x_c + \delta x' \approx R(x_c) + R'(x_c) \delta x $$
Since $R(x_c) = x_c$, we have:
$$ \delta x' = \lambda \delta x $$
where $\lambda = R'(x_c)$ is the **eigenvalue** of the transformation.

**Calculating $\lambda$**:
$$ R(x) = \frac{2x^2}{1+x^4} \implies \lambda = \frac{dR}{dx}\Big|_{x_c} \approx 1.68 $$
(You can derive this by differentiating the polynomial.)

**The Critical Exponent $\nu$**:
Since we rescaled the length of the system by a factor of $b=2$ (since we replaced 2 lengths with 1 in the series step), the correlation length $\xi$ must also rescale: $\xi' = \xi / b$.
Near the critical point, the correlation length diverges as $\xi \sim |T - T_c|^{-\nu}$.
From RG theory, one can show that:
$$ \nu = \frac{\ln b}{\ln \lambda} $$
Plugging in our numbers ($b=2, \lambda \approx 1.68$):
$$ \nu = \frac{\ln 2}{\ln 1.68} \approx 1.33 $$

**The Magic of Universality**:
This number $\nu \approx 1.33$ depends *only* on the fact that we used a diamond lattice. It does **not** depend on the specific initial value of $K$, or adding tiny next-nearest neighbor interactions. Any system that "flows" to this fixed point will share the exact same exponent $\nu$. This is why diverse systems (magnets, fluids) can be described by the exact same math near criticality.

