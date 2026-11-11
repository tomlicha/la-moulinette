import decouverte from '../../samples/workouts/decouverte.zwo?raw';
import rampe from '../../samples/workouts/rampe.erg?raw';
import sweetSpot from '../../samples/workouts/sweet-spot.mrc?raw';

/** Séances fournies avec l'application, en lecture seule : on peut les utiliser ou les copier pour les modifier. */
export const SAMPLE_WORKOUTS = [
  { id: 'decouverte', fileName: 'decouverte.zwo', text: decouverte },
  { id: 'sweet-spot', fileName: 'sweet-spot.mrc', text: sweetSpot },
  { id: 'rampe', fileName: 'rampe.erg', text: rampe },
];
