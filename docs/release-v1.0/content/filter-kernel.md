# CPU滤镜数值合同 v1



这是对 v0.1 留待固定算法的本次工程建议，需与计划一起评审；所有操作按 CSV 顺序执行。RGB 归一化至 `[0,1]`，每步 clamp，内部 float64，最后量化 `round(255×C)`；alpha 原字节不变。亮度 `Y=.2126R+.7152G+.0722B`。

| 操作 | 定义 |
|---|---|
| exposure:e | `clamp(C×2^e)` |
| contrast:k | `clamp((C-.5)×(1+k)+.5)` |
| saturation:s | `clamp(Y+(C-Y)×(1+s))` |
| temperature:t | `clamp([R+.08t,G+.02t,B-.08t])` |
| tint:q | `clamp([R+.04q,G-.08q,B+.04q])` |
| gamma:g | `C^(1/g)`，g>0 |
| grayscale:a | `C×(1-a)+Y×a` |
| sepia:a | 标准矩阵行 `[.393,.769,.189]`、`[.349,.686,.168]`、`[.272,.534,.131]` 后 clamp，再与输入按 a 混合 |
| duotone:dark,light | `dark×(1-Y)+light×Y`，颜色由十六进制转归一化 sRGB |
| posterize:L | `round(C×(L-1))/(L-1)`，L 为2–256整数 |
| vignette:v | 源图像素中心归一化到 x,y∈[-1,1]；`d=min(1,sqrt(x²+y²)/sqrt(2))`；RGB乘 `1-v×clamp((d-.2)/.8)^2` |
| grain:a | 源整数坐标 x,y 与 seed 混合：`h=seed XOR imul(x+1,73856093) XOR imul(y+1,19349663)`；MurmurHash3 fmix32 后转无符号 `n=h/4294967296-.5`；RGB各通道加 `a×n` |

fmix32：`h ^= h>>>16`；`h=imul(h,0x85ebca6b)`；`h ^= h>>>13`；`h=imul(h,0xc2b2ae35)`；`h ^= h>>>16`。grain 在同像素使用同一个噪声值；tile 坐标必须加 offset，因此切块不改变颗粒。

最终强度 s 使用 IEC sRGB 转线性函数（阈值 .04045，低段除12.92，高段 `((C+.055)/1.055)^2.4`），混合 `linear(original)×(1-s)+linear(effect)×s`，再转回 sRGB（阈值 .0031308，低段乘12.92，高段 `1.055×L^(1/2.4)-.055`）。s=0 必须字节直通。不得把 s 乘进每个配方参数来冒充此混合。
