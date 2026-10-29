//! Envio de ajustes entre telas (spec settings-transfer, design D7 de
//! `add-screen-customization`): pacotes guardados só na memória, por um código curto
//! de uso único que vence em 10 minutos. Nada vai para o disco nem para o log.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use bytes::Bytes;

/// Sem `0`, `O`, `1`, `I` nem `L`: 31 símbolos, 31⁶ ≈ 887 milhões de códigos.
pub const ALPHABET: &[u8; 31] = b"23456789ABCDEFGHJKMNPQRSTUVWXYZ";
pub const CODE_LEN: usize = 6;
/// Validade de um pacote.
pub const TTL: Duration = Duration::from_secs(600);
/// Pacotes guardados ao mesmo tempo.
pub const MAX_PACKS: usize = 500;
/// Tamanho máximo do pacote (corpo do `POST /api/pairing`).
pub const MAX_BODY: usize = 64 * 1024;

/// Fonte do instante atual, trocada nos testes para conferir o vencimento.
pub trait Clock: Send + Sync {
    fn now(&self) -> Instant;
}

/// O relógio do sistema (monotônico).
pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> Instant {
        Instant::now()
    }
}

/// Relógio parado, que só anda quando mandado.
pub struct ManualClock(Mutex<Instant>);

impl ManualClock {
    pub fn new() -> Self {
        ManualClock(Mutex::new(Instant::now()))
    }

    pub fn advance(&self, by: Duration) {
        let mut now = self.0.lock().unwrap_or_else(|e| e.into_inner());
        *now += by;
    }
}

impl Default for ManualClock {
    fn default() -> Self {
        Self::new()
    }
}

impl Clock for ManualClock {
    fn now(&self) -> Instant {
        *self.0.lock().unwrap_or_else(|e| e.into_inner())
    }
}

#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum PairingError {
    #[error("há {MAX_PACKS} envios pendentes; tente de novo em alguns minutos")]
    Full,
    #[error("o sistema não forneceu bytes aleatórios: {0}")]
    Random(String),
}

struct Pack {
    created: Instant,
    body: Bytes,
}

/// Pacotes pendentes, por código. A limpeza dos vencidos acontece a cada operação.
pub struct PairingStore {
    clock: Arc<dyn Clock>,
    packs: Mutex<HashMap<String, Pack>>,
}

impl PairingStore {
    pub fn new(clock: Arc<dyn Clock>) -> Self {
        PairingStore {
            clock,
            packs: Mutex::new(HashMap::new()),
        }
    }

    /// Guarda o pacote e devolve o código novo. Com o limite cheio, `Full`.
    pub fn put(&self, body: Bytes) -> Result<String, PairingError> {
        let now = self.clock.now();
        let mut packs = self.lock(now);
        if packs.len() >= MAX_PACKS {
            return Err(PairingError::Full);
        }
        // Repetir um código pendente é raríssimo (500 em 887 milhões), mas não pode
        // entregar o pacote de outra pessoa.
        let code = loop {
            let code = new_code(system_random).map_err(PairingError::Random)?;
            if !packs.contains_key(&code) {
                break code;
            }
        };
        packs.insert(code.clone(), Pack { created: now, body });
        Ok(code)
    }

    /// Entrega o pacote e o apaga na mesma operação. O código vale sem diferenciar
    /// maiúsculas; inexistente, vencido ou já usado dá `None`.
    pub fn take(&self, code: &str) -> Option<Bytes> {
        let code = normalize_code(code)?;
        let now = self.clock.now();
        self.lock(now).remove(&code).map(|pack| pack.body)
    }

    /// Pacotes válidos guardados agora.
    pub fn len(&self) -> usize {
        self.lock(self.clock.now()).len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Trava o mapa já sem os pacotes vencidos em `now`.
    fn lock(&self, now: Instant) -> std::sync::MutexGuard<'_, HashMap<String, Pack>> {
        let mut packs = self.packs.lock().unwrap_or_else(|e| e.into_inner());
        packs.retain(|_, pack| now.saturating_duration_since(pack.created) < TTL);
        packs
    }
}

/// Bytes aleatórios do sistema operacional.
fn system_random(buf: &mut [u8]) -> Result<(), String> {
    getrandom::fill(buf).map_err(|e| e.to_string())
}

/// Código de `CODE_LEN` símbolos de `ALPHABET`, com bytes de `fill`. Os bytes de 248 a
/// 255 são descartados (248 = 31 × 8), para que todo símbolo tenha a mesma chance.
pub fn new_code(mut fill: impl FnMut(&mut [u8]) -> Result<(), String>) -> Result<String, String> {
    let limit = ALPHABET.len() * 8;
    let mut code = String::with_capacity(CODE_LEN);
    let mut buf = [0u8; 16];
    while code.len() < CODE_LEN {
        fill(&mut buf)?;
        for b in buf.iter().map(|&b| usize::from(b)).filter(|&b| b < limit) {
            if code.len() == CODE_LEN {
                break;
            }
            code.push(char::from(ALPHABET[b % ALPHABET.len()]));
        }
    }
    Ok(code)
}

/// Código como o usuário digitou, na forma guardada; fora do formato, `None`.
pub fn normalize_code(code: &str) -> Option<String> {
    let code = code.trim().to_ascii_uppercase();
    (code.len() == CODE_LEN && code.bytes().all(|b| ALPHABET.contains(&b))).then_some(code)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (Arc<ManualClock>, PairingStore) {
        let clock = Arc::new(ManualClock::new());
        let store = PairingStore::new(clock.clone());
        (clock, store)
    }

    fn pack(n: usize) -> Bytes {
        Bytes::from(format!("{{\"n\":{n}}}"))
    }

    const MINUTE: Duration = Duration::from_secs(60);

    #[test]
    fn pairing_code_uses_the_alphabet() {
        let system = system_random;
        let mut seen = std::collections::HashSet::new();
        for _ in 0..2000 {
            let code = new_code(system).unwrap();
            assert_eq!(code.len(), CODE_LEN, "{code}");
            assert!(code.bytes().all(|b| ALPHABET.contains(&b)), "{code}");
            assert!(!code.contains(['0', 'O', '1', 'I', 'L']), "{code}");
            seen.insert(code);
        }
        // 2.000 sorteios em 887 milhões: repetição seria quase impossível
        assert!(seen.len() > 1990, "{} códigos distintos", seen.len());
        assert_eq!(ALPHABET.len(), 31);
    }

    #[test]
    fn pairing_code_discards_biased_bytes() {
        // 248..=255 são descartados; o resto vira ALPHABET[b % 31]
        let mut bytes = vec![248, 255, 0, 30, 31, 61, 250, 62, 247].into_iter();
        let fill = |buf: &mut [u8]| {
            for b in buf.iter_mut() {
                *b = bytes.next().unwrap_or(0);
            }
            Ok(())
        };
        assert_eq!(new_code(fill).unwrap(), "2Z2Z2Z");
        // falha da fonte aleatória vira erro, não um código
        assert!(new_code(|_: &mut [u8]| Err("sem entropia".into())).is_err());
    }

    #[test]
    fn pairing_code_is_case_insensitive() {
        let (_, store) = store();
        let code = store.put(pack(1)).unwrap();
        let lower = code.to_lowercase();
        assert_eq!(store.take(&format!(" {lower} ")), Some(pack(1)));
        assert_eq!(normalize_code("abc234"), Some("ABC234".into()));
        for bad in [
            "", "ABC23", "ABC2345", "ABC23O", "ABC231", "ABC23L", "ABC 23", "ÁBC234",
        ] {
            assert_eq!(normalize_code(bad), None, "{bad:?}");
            assert_eq!(store.take(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn pairing_pack_is_taken_once() {
        let (_, store) = store();
        let code = store.put(pack(1)).unwrap();
        let other = store.put(pack(2)).unwrap();
        assert_ne!(code, other);
        assert_eq!(store.len(), 2);
        assert_eq!(store.take(&code), Some(pack(1)));
        assert_eq!(store.take(&code), None);
        assert_eq!(store.len(), 1);
        assert_eq!(store.take(&other), Some(pack(2)));
        assert!(store.is_empty());
    }

    #[test]
    fn pairing_pack_expires_after_ten_minutes() {
        let (clock, store) = store();
        let early = store.put(pack(1)).unwrap();
        clock.advance(2 * MINUTE);
        assert_eq!(store.take(&early), Some(pack(1)), "2 minutos");

        let edge = store.put(pack(2)).unwrap();
        clock.advance(10 * MINUTE - Duration::from_millis(1));
        assert_eq!(
            store.take(&edge),
            Some(pack(2)),
            "um instante antes de vencer"
        );

        let exact = store.put(pack(3)).unwrap();
        let late = store.put(pack(4)).unwrap();
        clock.advance(10 * MINUTE);
        assert_eq!(store.take(&exact), None, "10 minutos");
        clock.advance(MINUTE);
        assert_eq!(store.take(&late), None, "11 minutos");
        assert!(store.is_empty());
    }

    #[test]
    fn pairing_limit_of_500() {
        let (clock, store) = store();
        let mut codes = Vec::new();
        for n in 0..MAX_PACKS {
            codes.push(store.put(pack(n)).unwrap());
        }
        assert_eq!(store.len(), MAX_PACKS);
        assert_eq!(store.put(pack(999)), Err(PairingError::Full));

        // um pacote usado abre uma vaga
        assert_eq!(store.take(&codes[0]), Some(pack(0)));
        let again = store.put(pack(1000)).unwrap();
        assert_eq!(store.put(pack(1001)), Err(PairingError::Full));

        // vencidos também liberam: todos menos o último (guardado 5 minutos depois)
        clock.advance(5 * MINUTE);
        store.take(&again);
        let fresh = store.put(pack(1002)).unwrap();
        clock.advance(5 * MINUTE);
        assert_eq!(store.len(), 1);
        assert!(store.put(pack(1003)).is_ok());
        assert_eq!(store.take(&fresh), Some(pack(1002)));
    }
}
