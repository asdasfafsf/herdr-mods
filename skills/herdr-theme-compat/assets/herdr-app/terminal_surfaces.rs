//! Optional paint-time replacements for explicit terminal backgrounds.
//! Original PTY bytes and cell styles stay intact, so removing the theme rules
//! restores the screen without asking the terminal program to redraw.

pub type Color = [u8; 3];
pub type Rule = (Color, Color);

pub fn hex(value: &str) -> Option<Color> {
    let value = value.strip_prefix('#').unwrap_or(value);
    if value.len() != 6 || !value.bytes().all(|c| c.is_ascii_hexdigit()) { return None; }
    let value = u32::from_str_radix(value, 16).ok()?;
    Some([(value >> 16) as u8, (value >> 8) as u8, value as u8])
}

pub fn parse_rule(key: &str, value: &str) -> Option<Rule> {
    let source = key.strip_prefix("terminal_bg_")?;
    Some((hex(source)?, hex(value)?))
}

/// Explicit theme opt-in. Plain themes need no new keys or modified settings.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CodexColors {
    pub input: Color,
    pub history: Color,
    pub add: Color,
    pub delete: Color,
}

impl CodexColors {
    pub fn parse(mut get: impl FnMut(&str) -> Option<String>) -> Option<Self> {
        Some(Self {
            input: hex(&get("terminal_codex_input")?)?,
            history: hex(&get("terminal_codex_history")?)?,
            add: hex(&get("terminal_codex_add")?)?,
            delete: hex(&get("terminal_codex_delete")?)?,
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Role { Input, History, Hud, Quiet, Hover, Add, Delete, AddNumber, DeleteNumber }

const ROLES: [Role; 9] = [Role::Input, Role::History, Role::Hud, Role::Quiet,
    Role::Hover, Role::Add, Role::Delete, Role::AddNumber, Role::DeleteNumber];

fn light(base: Color) -> bool {
    0.299 * base[0] as f32 + 0.587 * base[1] as f32 + 0.114 * base[2] as f32 > 128.0
}

// Codex 0.169 truncates each f32 channel, rather than rounding the result.
fn blend(top: Color, base: Color, alpha: f32) -> Color {
    std::array::from_fn(|i| (top[i] as f32 * alpha + base[i] as f32 * (1.0 - alpha)) as u8)
}

fn shade(surface: Color, base: Color) -> Color {
    if light(base) { blend([0; 3], surface, 0.04) }
    else { blend([255; 3], surface, 0.12) }
}

/// Colors produced by Codex 0.169's style.rs and fallback diff palette.
fn palette(base: Color, custom: Option<CodexColors>) -> [Color; 9] {
    let is_light = light(base);
    let input = custom.map_or_else(|| shade(base, base), |c| c.input);
    let history = custom.map_or_else(|| if is_light { blend([0; 3], base, 0.02) }
        else { blend([255; 3], base, 0.16) }, |c| c.history);
    let hud = if custom.is_some() { blend(input, base, 0.55) }
        else { blend(if is_light { [0; 3] } else { [255; 3] }, base, 0.052) };
    let add = custom.map_or(if is_light { [218, 251, 225] } else { [33, 58, 43] }, |c| c.add);
    let delete = custom.map_or(if is_light { [255, 235, 233] } else { [74, 34, 29] }, |c| c.delete);
    let add_number = if custom.is_none() && is_light { [172, 238, 187] } else { add };
    let delete_number = if custom.is_none() && is_light { [255, 206, 203] } else { delete };
    [input, history, hud, blend(input, base, 0.40), shade(shade(input, base), base),
        add, delete, add_number, delete_number]
}

/// Paint-only adapter for one foreground Codex process. It never rewrites the
/// terminal buffer. Opt-in persists across theme changes only for that process,
/// allowing its cached light surfaces to return to a dark native palette.
#[derive(Default)]
pub struct CodexAdapter {
    process: Option<u64>,
    remembered_process: Option<u64>,
    enabled: bool,
    bases: Vec<Color>,
    sources: std::collections::BTreeMap<Color, Option<Role>>,
    destination: Option<[Color; 9]>,
}

impl CodexAdapter {
    pub fn process(&self) -> Option<u64> { self.process }
    pub fn active(&self) -> bool { self.process.is_some() && self.enabled }

    fn register(&mut self, source: Color, role: Role) {
        self.sources.entry(source).and_modify(|old| {
            if *old != Some(role) { *old = None; }
        }).or_insert(Some(role));
    }

    fn learn(&mut self, base: Color) {
        if self.bases.contains(&base) || self.bases.len() >= 64 { return; }
        self.bases.push(base);
        let colors = palette(base, None);
        for (color, role) in colors.into_iter().zip(ROLES) {
            // Dark gutters share their line's exact fill, so are not a
            // distinguishable source role. Light gutters stay distinct.
            let role = match role {
                Role::AddNumber if color == colors[Role::Add as usize] => Role::Add,
                Role::DeleteNumber if color == colors[Role::Delete as usize] => Role::Delete,
                role => role,
            };
            self.register(color, role);
        }
    }

    pub fn update(&mut self, process: Option<u64>, base: Color, custom: Option<CodexColors>) -> bool {
        let old = (self.process, self.enabled, self.destination);
        // An editor/tool may temporarily own the foreground group. Suspend
        // mapping there, but retain the same Codex process's startup colors.
        if process.is_some() && self.remembered_process != process {
            *self = Self::default();
            self.remembered_process = process;
            if process.is_some() {
                // Known native defaults and bundled Chiikawa base also cover
                // attached processes that started before this window opened.
                for source in [[23, 25, 29], [17, 23, 32], [21, 28, 25],
                    [33, 37, 43], [255; 3], [248, 245, 236], [0; 3]] { self.learn(source); }
                // Codex's fixed fallback history and ANSI-256 diff surfaces.
                for (color, role) in [([68; 3], Role::History), ([0, 95, 0], Role::Add),
                    ([95, 0, 0], Role::Delete), ([215, 255, 215], Role::Add),
                    ([255, 215, 215], Role::Delete), ([175, 255, 175], Role::AddNumber),
                    ([255, 175, 175], Role::DeleteNumber)] { self.register(color, role); }
            }
        }
        self.process = process;
        if process.is_some() {
            self.learn(base);
            self.enabled |= custom.is_some();
            self.destination = self.enabled.then(|| palette(base, custom));
        } else {
            self.destination = None;
        }
        old != (self.process, self.enabled, self.destination)
    }

    pub fn remap(&self, fg: Color, bg: Option<Color>, theme_fg: Color) -> (Color, Option<Color>) {
        if !self.active() { return (fg, bg); }
        let Some(source) = bg else { return (fg, bg); };
        let Some(Some(role)) = self.sources.get(&source) else { return (fg, bg); };
        let Some(targets) = self.destination else { return (fg, bg); };
        let target = targets[*role as usize];
        (readable(fg, target, theme_fg), Some(target))
    }
}

fn luminance(color: Color) -> f32 {
    let channel = |value: u8| {
        let value = value as f32 / 255.0;
        if value <= 0.04045 { value / 12.92 } else { ((value + 0.055) / 1.055).powf(2.4) }
    };
    0.2126 * channel(color[0]) + 0.7152 * channel(color[1]) + 0.0722 * channel(color[2])
}

fn contrast(a: Color, b: Color) -> f32 {
    let (a, b) = (luminance(a), luminance(b));
    (a.max(b) + 0.05) / (a.min(b) + 0.05)
}

fn readable(fg: Color, bg: Color, theme_fg: Color) -> Color {
    if contrast(fg, bg) >= 4.5 { return fg; }
    // Move only as far toward the theme ink as readability requires. Distinct
    // syntax colors remain distinct instead of all becoming black or white.
    let target = if contrast(theme_fg, bg) >= 4.5 { theme_fg }
        else if contrast([0, 0, 0], bg) >= contrast([255, 255, 255], bg) { [0, 0, 0] }
        else { [255, 255, 255] };
    let mix = |amount: f32| std::array::from_fn(|i| {
        (fg[i] as f32 + (target[i] as f32 - fg[i] as f32) * amount).round() as u8
    });
    let (mut low, mut high) = (0.0, 1.0);
    for _ in 0..12 {
        let middle = (low + high) / 2.0;
        if contrast(mix(middle), bg) >= 4.5 { high = middle; } else { low = middle; }
    }
    mix(high)
}

pub fn remap(fg: Color, bg: Option<Color>, theme_fg: Color, rules: &[Rule]) -> (Color, Option<Color>) {
    let Some(source) = bg else { return (fg, bg); };
    let Some((_, destination)) = rules.iter().find(|(from, _)| *from == source) else { return (fg, bg); };
    (readable(fg, *destination, theme_fg), Some(*destination))
}

#[cfg(test)]
mod tests {
    use super::*;
    const INK: Color = [80, 60, 46];
    const CREAM: Color = [241, 223, 189];
    const OLD: Color = [41, 41, 41];
    const CUSTOM: CodexColors = CodexColors { input: CREAM, history: [244, 236, 219],
        add: [230, 239, 217], delete: [249, 226, 217] };

    #[test]
    fn codex_surface_opt_in_is_complete_and_process_scoped() {
        assert!(CodexColors::parse(|_| None).is_none());
        assert!(CodexColors::parse(|key| (key != "terminal_codex_delete").then(|| "#f1dfbd".into())).is_none());
        let mut adapter = CodexAdapter::default();
        let fg = [210, 212, 217];
        let bg = Some([50, 52, 56]);
        adapter.update(None, [248, 245, 236], Some(CUSTOM));
        assert_eq!(adapter.remap(fg, bg, INK), (fg, bg), "other programs are untouched");
        adapter.update(Some(7), [23, 25, 29], None);
        assert_eq!(adapter.remap(fg, bg, INK), (fg, bg), "no opt-in means native output");
        adapter.update(Some(7), [248, 245, 236], Some(CUSTOM));
        assert_eq!(adapter.remap(fg, bg, INK).1, Some(CREAM));
        adapter.update(Some(8), [23, 25, 29], None);
        assert_eq!(adapter.remap(fg, bg, INK), (fg, bg), "a new process must opt in independently");
        adapter.update(None, [23, 25, 29], None);
        assert!(!adapter.active());
    }

    #[test]
    fn codex_surface_arbitrary_observed_startup_and_both_directions() {
        for (base, input, history) in [([12, 27, 43], [41, 54, 68], [50, 63, 76]),
            ([232, 221, 199], [222, 212, 191], [227, 216, 195])] {
            let mut adapter = CodexAdapter::default();
            adapter.update(Some(7), base, None);
            adapter.update(Some(7), [248, 245, 236], Some(CUSTOM));
            assert_eq!(adapter.remap(INK, Some(input), INK).1, Some(CREAM));
            assert_eq!(adapter.remap(INK, Some(history), INK).1, Some(CUSTOM.history));
            adapter.update(Some(7), [17, 23, 32], None);
            assert_eq!(adapter.remap(INK, Some(input), [220; 3]).1, Some([45, 50, 58]));
            assert_eq!(adapter.remap(INK, Some(history), [220; 3]).1, Some([55, 60, 67]));
            adapter.update(Some(7), [255; 3], None);
            assert_eq!(adapter.remap(INK, Some(input), INK).1, Some([244; 3]));
            assert_eq!(adapter.remap(INK, Some(history), INK).1, Some([249; 3]));
        }
    }

    #[test]
    fn codex_surface_resumes_after_temporary_other_program() {
        let mut adapter = CodexAdapter::default();
        let source = Some([238, 235, 226]);
        adapter.update(Some(7), [248, 245, 236], Some(CUSTOM));
        adapter.update(Some(7), [17, 23, 32], None);
        assert_eq!(adapter.remap(INK, source, [220; 3]).1, Some([45, 50, 58]));
        adapter.update(None, [17, 23, 32], None);
        assert_eq!(adapter.remap(INK, source, [220; 3]), (INK, source));
        adapter.update(Some(7), [17, 23, 32], None);
        assert_eq!(adapter.remap(INK, source, [220; 3]).1, Some([45, 50, 58]));
        adapter.update(Some(8), [17, 23, 32], None);
        assert_eq!(adapter.remap(INK, source, [220; 3]), (INK, source));
    }

    #[test]
    fn codex_surface_diff_gutters_syntax_and_unknown_colors() {
        let mut adapter = CodexAdapter::default();
        adapter.update(Some(7), [248, 245, 236], Some(CUSTOM));
        for source in [[33, 58, 43], [218, 251, 225], [0, 95, 0], [215, 255, 215]] {
            assert_eq!(adapter.remap(INK, Some(source), INK).1, Some(CUSTOM.add));
        }
        for source in [[74, 34, 29], [255, 235, 233], [95, 0, 0], [255, 215, 215]] {
            assert_eq!(adapter.remap(INK, Some(source), INK).1, Some(CUSTOM.delete));
        }
        let source = Some([238, 235, 226]);
        let colors: Vec<_> = [[240, 165, 173], [186, 213, 162], [176, 203, 239]].into_iter()
            .map(|fg| adapter.remap(fg, source, INK).0).collect();
        for (i, color) in colors.iter().enumerate() {
            assert!(contrast(*color, CREAM) >= 4.5);
            assert!(!colors[..i].contains(color));
        }
        let unknown = Some([127, 3, 211]);
        assert_eq!(adapter.remap(INK, unknown, INK), (INK, unknown));
        adapter.update(Some(7), [23, 25, 29], None);
        assert_eq!(adapter.remap(INK, Some([172, 238, 187]), [220; 3]).1, Some([33, 58, 43]));
        adapter.update(Some(7), [255; 3], None);
        assert_eq!(adapter.remap(INK, Some([172, 238, 187]), INK).1, Some([172, 238, 187]));
        assert_eq!(adapter.remap(INK, Some([175, 255, 175]), INK).1, Some([172, 238, 187]));
        assert_eq!(adapter.remap(INK, Some([255, 206, 203]), INK).1, Some([255, 206, 203]));
    }

    #[test]
    fn codex_surface_ambiguous_sources_and_bounded_observation() {
        let mut adapter = CodexAdapter::default();
        adapter.update(Some(7), [248, 245, 236], Some(CUSTOM));
        adapter.register([127, 3, 211], Role::Input);
        adapter.register([127, 3, 211], Role::History);
        assert_eq!(adapter.remap(INK, Some([127, 3, 211]), INK).1, Some([127, 3, 211]));
        for i in 0..255 { adapter.update(Some(7), [i, 16, 77], Some(CUSTOM)); }
        assert_eq!(adapter.bases.len(), 64);
        assert!(adapter.sources.len() <= 64 * 9 + 8);
    }

    #[test]
    fn strict_opt_in_and_exact_colors() {
        assert_eq!(parse_rule("terminal_bg_292929", "#f1dfbd"), Some((OLD, CREAM)));
        for key in ["background", "terminal_bg_foo", "terminal_bg_292929ff", "terminal_bg_💛"] {
            assert!(parse_rule(key, "#f1dfbd").is_none());
        }
        assert!(parse_rule("terminal_bg_292929", "#f1dfbd00").is_none());
        let fg = [210, 212, 217];
        for bg in [None, Some(OLD), Some([42, 41, 41])] {
            assert_eq!(remap(fg, bg, INK, &[]), (fg, bg));
        }
        assert_eq!(remap(fg, Some([42, 41, 41]), INK, &[(OLD, CREAM)]), (fg, Some([42, 41, 41])));
    }

    #[test]
    fn readable_ink_and_distinct_syntax_colors() {
        let rules = [(OLD, CREAM)];
        assert_eq!(remap(INK, Some(OLD), INK, &rules), (INK, Some(CREAM)));
        let foregrounds = [[210, 212, 217], [240, 165, 173], [186, 213, 162], [176, 203, 239]];
        let colors: Vec<_> = foregrounds.into_iter().map(|fg| remap(fg, Some(OLD), INK, &rules).0).collect();
        for color in &colors { assert!(contrast(*color, CREAM) >= 4.5); }
        for (i, color) in colors.iter().enumerate() { assert!(!colors[..i].contains(color)); }
    }

    #[test]
    fn removing_rules_restores_original_cells() {
        let original = ([210, 212, 217], Some(OLD));
        assert_ne!(remap(original.0, original.1, INK, &[(OLD, CREAM)]), original);
        assert_eq!(remap(original.0, original.1, INK, &[]), original);
    }

    #[test]
    fn dark_themes_and_unreadable_theme_ink() {
        for destination in [[24, 25, 28], CREAM, [128, 128, 128]] {
            let (fg, bg) = remap(destination, Some(OLD), destination, &[(OLD, destination)]);
            assert_eq!(bg, Some(destination));
            assert!(contrast(fg, destination) >= 4.5);
        }
    }
}
