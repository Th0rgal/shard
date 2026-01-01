export function JsonLd() {
  const softwareApplication = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Shard Launcher",
    description:
      "A minimal, content-addressed Minecraft launcher focused on stability and reproducibility. One library. Infinite profiles.",
    url: "https://shard.thomas.md",
    applicationCategory: "GameApplication",
    operatingSystem: ["macOS", "Windows", "Linux"],
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    author: {
      "@type": "Person",
      name: "Thomas Marchand",
      url: "https://thomas.md",
    },
    downloadUrl: "https://shard.thomas.md/docs/getting-started",
    keywords: [
      "Minecraft",
      "launcher",
      "mod manager",
      "Fabric",
      "Forge",
      "Quilt",
      "NeoForge",
      "Modrinth",
      "CurseForge",
    ],
    featureList: [
      "Content-addressed storage for mods and resource packs",
      "Multiple profile support",
      "Modrinth and CurseForge integration",
      "Fabric, Forge, Quilt, and NeoForge support",
      "CLI-first design",
    ],
  };

  const organization = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Shard",
    url: "https://shard.thomas.md",
    logo: "https://shard.thomas.md/icon-512.png",
    sameAs: ["https://github.com/th0rgal/shard"],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareApplication) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organization) }}
      />
    </>
  );
}
