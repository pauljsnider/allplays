export function resolveZip(zipOrCity: string): string {
  const normalizedInput = String(zipOrCity || '').trim().toLowerCase();

  // Simple mapping for common cities/zips for demonstration
  switch (normalizedInput) {
    case 'atlanta':
    case '30303':
      return 'Atlanta, GA';
    case 'new york':
    case 'nyc':
    case '10001':
      return 'New York, NY';
    case 'los angeles':
    case 'la':
    case '90012':
      return 'Los Angeles, CA';
    case 'chicago':
    case '60601':
      return 'Chicago, IL';
    // Add more mappings as needed
    default:
      // If it looks like a zip code, just return it as is for now
      if (/^\d{5}$/.test(normalizedInput)) {
        return `ZIP: ${normalizedInput}`;
      }
      // Otherwise, return capitalized input
      return normalizedInput.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') || 'Unknown Location';
  }
}
