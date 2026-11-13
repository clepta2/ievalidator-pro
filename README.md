# IEValidator Pro API & SDK Oficial

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Edge Latency](https://img.shields.io/badge/Latency-%3C1ms-10b981.svg)](https://ponte.ozpro.com.br)
[![SINTEGRA](https://img.shields.io/badge/SINTEGRA-27%20Estados-0284c7.svg)](https://www.confaz.fazenda.gov.br)

SDK e API Oficial de **Validação Algorítmica e Formatação de Inscrição Estadual (IE) de todos os 27 Estados do Brasil (SINTEGRA / CONFAZ)** na borda Cloudflare Anycast (<1ms).

---

## 🚀 Instalação & Uso Rápido

```bash
npm install ievalidator-pro
```

### Exemplo em Node.js / JavaScript
```javascript
import { IEValidatorPro } from 'ievalidator-pro';

// 1. Validação com formatação canônica
const resultado = IEValidatorPro.validar('SP', '110042490114');
console.log(resultado.valido); // true
console.log(resultado.ie);     // 110.042.490.114

// 2. Não-Contribuinte (ISENTO)
const isento = IEValidatorPro.validar('RJ', 'ISENTO');
console.log(isento.isento);    // true
```

### Exemplo via cURL
```bash
curl -X GET "https://ponte.ozpro.com.br/api/ie?uf=SP&ie=110042490114"
```

---

## 🧪 Testes Unitários

```bash
npm test
```

Licença **MIT** &copy; 2026 Clepta Tech.
