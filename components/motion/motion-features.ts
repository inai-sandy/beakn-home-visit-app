// HVA-271: framer-motion feature pack, isolated so LazyMotion can load
// it ASYNCHRONOUSLY — the ~25KB animation engine leaves the critical
// first-paint bundle and arrives a moment later (animations no-op
// gracefully until then). domMax because layout/layoutId (nav pill,
// list glide) need it.
import { domMax } from 'framer-motion';

export default domMax;
