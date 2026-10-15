use crate::model::Palette;
use image::{imageops::FilterType, DynamicImage};
use std::collections::BTreeMap;

pub fn rgb_to_lab(rgb: [u8; 3]) -> [f64; 3] {
    let c = rgb.map(|v| {
        let x = v as f64 / 255.;
        if x > 0.04045 {
            ((x + 0.055) / 1.055).powf(2.4)
        } else {
            x / 12.92
        }
    });
    let xyz = [
        (c[0] * 0.4124564 + c[1] * 0.3575761 + c[2] * 0.1804375) / 0.95047,
        c[0] * 0.2126729 + c[1] * 0.7151522 + c[2] * 0.0721750,
        (c[0] * 0.0193339 + c[1] * 0.1191920 + c[2] * 0.9503041) / 1.08883,
    ];
    let f = xyz.map(|x| {
        if x > 0.008856 {
            x.cbrt()
        } else {
            7.787 * x + 16. / 116.
        }
    });
    [
        116. * f[1] - 16.,
        500. * (f[0] - f[1]),
        200. * (f[1] - f[2]),
    ]
}
pub fn parse_hex(s: &str) -> Option<[u8; 3]> {
    let h = s.strip_prefix('#').unwrap_or(s);
    if h.len() == 3 && h.bytes().all(|c| c.is_ascii_hexdigit()) {
        let expanded: String = h.chars().flat_map(|c| [c, c]).collect();
        return parse_hex(&expanded);
    }
    if h.len() != 6 || !h.is_ascii() {
        return None;
    }
    Some([
        u8::from_str_radix(&h[0..2], 16).ok()?,
        u8::from_str_radix(&h[2..4], 16).ok()?,
        u8::from_str_radix(&h[4..6], 16).ok()?,
    ])
}
pub fn distance(a: &[f64; 3], b: &[f64; 3]) -> f64 {
    a.iter()
        .zip(b)
        .map(|(x, y)| (x - y).powi(2))
        .sum::<f64>()
        .sqrt()
}
/// CIEDE2000, with unit lightness/chroma/hue weighting (Sharma et al.).
pub fn delta_e_2000(a: &[f64; 3], b: &[f64; 3]) -> f64 {
    let [l1, a1, b1] = *a; let [l2, a2, b2] = *b;
    let cbar = (a1.hypot(b1) + a2.hypot(b2)) / 2.;
    let g = 0.5 * (1. - (cbar.powi(7) / (cbar.powi(7) + 25f64.powi(7))).sqrt());
    let ap1 = (1. + g) * a1; let ap2 = (1. + g) * a2;
    let c1 = ap1.hypot(b1); let c2 = ap2.hypot(b2);
    let hue = |x: f64, y: f64| if x == 0. && y == 0. { 0. } else { y.atan2(x).to_degrees().rem_euclid(360.) };
    let h1 = hue(ap1, b1); let h2 = hue(ap2, b2);
    let dl = l2 - l1; let dc = c2 - c1;
    let mut dh = h2 - h1;
    if c1 * c2 == 0. { dh = 0.; } else if dh > 180. { dh -= 360.; } else if dh < -180. { dh += 360.; }
    let dh = 2. * (c1 * c2).sqrt() * (dh / 2.).to_radians().sin();
    let lb = (l1 + l2) / 2.; let cb = (c1 + c2) / 2.;
    let hb = if c1 * c2 == 0. { h1 + h2 } else if (h1 - h2).abs() <= 180. { (h1 + h2) / 2. } else if h1 + h2 < 360. { (h1 + h2 + 360.) / 2. } else { (h1 + h2 - 360.) / 2. };
    let cos = |v: f64| v.to_radians().cos();
    let t = 1. - 0.17 * cos(hb - 30.) + 0.24 * cos(2. * hb) + 0.32 * cos(3. * hb + 6.) - 0.20 * cos(4. * hb - 63.);
    let sl = 1. + 0.015 * (lb - 50.).powi(2) / (20. + (lb - 50.).powi(2)).sqrt();
    let sc = 1. + 0.045 * cb; let sh = 1. + 0.015 * cb * t;
    let rt = -2. * (cb.powi(7) / (cb.powi(7) + 25f64.powi(7))).sqrt() * (60. * (-((hb - 275.) / 25.).powi(2)).exp()).to_radians().sin();
    ((dl / sl).powi(2) + (dc / sc).powi(2) + (dh / sh).powi(2) + rt * dc / sc * dh / sh).max(0.).sqrt()
}
pub fn extract(image: &DynamicImage) -> Vec<Palette> {
    let rgba = image.resize(64, 64, FilterType::Triangle).to_rgba8();
    let mut histogram: BTreeMap<[u8; 3], (f64, [f64; 3])> = BTreeMap::new();
    for p in rgba.pixels() {
        if p[3] < 128 {
            continue;
        }
        let rgb = [p[0], p[1], p[2]];
        let key = rgb.map(|v| v / 16);
        let v = histogram.entry(key).or_insert((0., [0.; 3]));
        v.0 += 1.;
        for (i, channel) in rgb.iter().enumerate() {
            v.1[i] += *channel as f64;
        }
    }
    if histogram.is_empty() {
        return vec![];
    }
    let samples: Vec<([f64; 3], [u8; 3], f64)> = histogram
        .values()
        .map(|(n, rgb)| {
            let rgb = rgb.map(|x| (x / n).round() as u8);
            (rgb_to_lab(rgb), rgb, *n)
        })
        .collect();
    let total: f64 = samples.iter().map(|x| x.2).sum();
    let mut centers = vec![samples.iter().max_by(|a, b| a.2.total_cmp(&b.2)).unwrap().0];
    for _ in 1..7.min(samples.len()) {
        let next = samples
            .iter()
            .max_by(|a, b| {
                let score = |s: &([f64; 3], [u8; 3], f64)| {
                    centers
                        .iter()
                        .map(|c| distance(&s.0, c))
                        .fold(f64::INFINITY, f64::min)
                        * s.2.sqrt()
                };
                score(a).total_cmp(&score(b))
            })
            .unwrap()
            .0;
        if centers.iter().any(|c| distance(c, &next) < 3.) {
            break;
        }
        centers.push(next);
    }
    let nearest = |lab: &[f64; 3], cs: &Vec<[f64; 3]>| {
        cs.iter()
            .enumerate()
            .min_by(|a, b| distance(lab, a.1).total_cmp(&distance(lab, b.1)))
            .unwrap()
            .0
    };
    for _ in 0..10 {
        let mut sums = vec![([0.; 3], 0.); centers.len()];
        for (lab, _, weight) in &samples {
            let k = nearest(lab, &centers);
            for (j, x) in lab.iter().enumerate() {
                sums[k].0[j] += x * weight;
            }
            sums[k].1 += weight;
        }
        for (k, (sum, n)) in sums.iter().enumerate() {
            if *n > 0. {
                centers[k] = sum.map(|v| v / n);
            }
        }
    }
    let mut sums = vec![([0.; 3], 0.); centers.len()];
    for (lab, rgb, n) in samples {
        let k = nearest(&lab, &centers);
        for (j, x) in rgb.iter().enumerate() {
            sums[k].0[j] += *x as f64 * n;
        }
        sums[k].1 += n;
    }
    let mut result: Vec<Palette> = sums
        .into_iter()
        .filter(|(_, n)| n / total >= 0.015)
        .map(|(rgb, n)| {
            let rgb = rgb.map(|v| (v / n).round() as u8);
            Palette {
                hex: format!("#{:02x}{:02x}{:02x}", rgb[0], rgb[1], rgb[2]),
                lab: rgb_to_lab(rgb),
                weight: n / total,
            }
        })
        .collect();
    result.sort_by(|a, b| b.weight.total_cmp(&a.weight));
    result
}
pub fn match_distance(palette: &[Palette], target: &[f64; 3], dominant: bool) -> Option<f64> {
    palette
        .iter()
        .enumerate()
        .filter(|(i, p)| !dominant || (*i < 2 && p.weight >= 0.15))
        .map(|(_, p)| delta_e_2000(&p.lab, target))
        .min_by(f64::total_cmp)
}
/// Palette-level hardware mask; retain black finishes whose color accents are tiny.
pub fn mask_weapon_hardware(palette: &mut Vec<Palette>) {
    let colored: f64 = palette.iter().filter(|p| p.lab[1].hypot(p.lab[2]) > 12.).map(|p| p.weight).sum();
    if colored < 0.20 { return; }
    palette.retain(|p| !(p.lab[0] < 38. && p.lab[1].hypot(p.lab[2]) < 8.));
    let total: f64 = palette.iter().map(|p| p.weight).sum();
    if total > 0. { for p in palette { p.weight /= total; } }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn conversion_and_validation() {
        assert!(distance(&rgb_to_lab([255, 0, 0]), &[53.24, 80.09, 67.20]) < 0.1);
        assert!(parse_hex("#ff0000").is_some());
        assert!(parse_hex("é00000").is_none());
        assert_eq!(parse_hex("#abc"), Some([170, 187, 204]));
        assert_eq!(parse_hex("#ggg"), None);
        assert!((delta_e_2000(&[50., 2.6772, -79.7751], &[50., 0., -82.7485]) - 2.0425).abs() < 0.0001);
    }
    #[test]
    fn alpha_and_accents() {
        let mut img = image::RgbaImage::from_pixel(64, 64, image::Rgba([0, 0, 255, 0]));
        for y in 0..32 {
            for x in 0..64 {
                img.put_pixel(
                    x,
                    y,
                    image::Rgba(if x < 56 {
                        [20, 20, 20, 255]
                    } else {
                        [235, 20, 20, 255]
                    }),
                );
            }
        }
        let p = extract(&DynamicImage::ImageRgba8(img));
        let red = rgb_to_lab([235, 20, 20]);
        assert!(match_distance(&p, &red, false).unwrap() < 4.);
        assert!(match_distance(&p, &red, true).unwrap() > 20.);
        assert!(p.iter().all(|x| x.lab[2] > -50.));
    }
}
