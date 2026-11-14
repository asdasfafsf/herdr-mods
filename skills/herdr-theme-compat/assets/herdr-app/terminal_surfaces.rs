//! Optional paint-time replacements for explicit terminal backgrounds.
//! Original PTY bytes and cell styles stay intact, so removing the theme rules
//! restores the screen without asking the terminal program to redraw.

pub type Color = [u8; 3];
pub type Rule = (Color, Color);

pub fn parse_rule(key: &str, value: &str) -> Option<Rule> {
    let source = key.strip_prefix("terminal_bg_")?;
    fn hex(value: &str) -> Option<Color> {
        let value = value.strip_prefix('#').unwrap_or(value);
        if value.len() != 6 || !value.bytes().all(|c| c.is_ascii_hexdigit()) { return None; }
        let value = u32::from_str_radix(value, 16).ok()?;
        Some([(value >> 16) as u8, (value >> 8) as u8, value as u8])
    }
    Some((hex(source)?, hex(value)?))
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
