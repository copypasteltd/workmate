# 字体覆盖检查依据 / Font coverage references

本轮采用仓库现有的 `@napi-rs/canvas` 与固定 Noto Sans TC，不引入新字体服务。字体文件、许可文本与来源信息保留在各自版本中。

Unicode 检查依据 Microsoft 的 [OpenType cmap 规范](https://learn.microsoft.com/en-us/typography/opentype/spec/cmap)：缺字映射为 glyph 0；有完整字符映射时，不能把不同子表的字符集合简单合并来假定渲染器支持所有字符。当前实现限定 Unicode format 4/12，并在同类可选映射之间采取保守检查。变体序列及其他 cmap 格式不在本轮覆盖承诺内。

glyph 上界依据 [OpenType maxp 规范](https://learn.microsoft.com/en-us/typography/opentype/spec/maxp) 的实际 `numGlyphs`。检查同时约束文件大小、表目录、子表边界、段与组的顺序，以及字符到 glyph 的寻址范围。生产时再把实际字体加载交给渲染器并固定轮廓；结构校验不代表字体许可证已获法律核验。

The implementation checks actual standalone SFNT bytes and bounded Unicode mappings before registration. It prefers full repertoire mappings and avoids treating inconsistent subtables as a union. The JSON source retains editable text and font references; path output fixes appearance. This is a supported font subset, not a claim that every OpenType shaping or variation feature has been qualified.
