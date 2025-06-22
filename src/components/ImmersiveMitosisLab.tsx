'use client';

import React, { useState, useEffect, useRef, Suspense, useCallback, memo, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  OrbitControls,
  PerspectiveCamera,
  Environment,
  Text,
  Html,
  useHelper,
  Stats
} from '@react-three/drei';
import * as THREE from 'three';

interface CellData {
  id: number;
  position: [number, number, number];
  stage: MitosisStage;
  divisionProgress: number;
  mutationLevel: number;
  age: number;
  isReset?: boolean;
  mitosisFailed?: boolean; // New flag to track mitosis failure
}

interface ChromosomeData {
  id: number;
  color: string;
  position: [number, number, number];
  rotation: [number, number, number];
  pairId: number;
  hasMutation: boolean;
  condensationLevel: number;
}

interface GridPosition {
  x: number;
  y: number;
  z: number;
  isOccupied: boolean;
}

type MitosisStage = 'interphase' | 'prophase' | 'prometaphase' | 'metaphase' | 'anaphase' | 'telophase' | 'cytokinesis';

// Constants
const CHROMOSOME_COLORS = ['#e74c3c', '#2ecc71', '#3498db', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#34495e'];
const STAGE_DESCRIPTIONS: Record<MitosisStage, string> = {
  interphase: "Cell grows and DNA replicates. Chromosomes are not visible.",
  prophase: "Chromosomes condense and become visible. Nuclear envelope begins to break down.",
  prometaphase: "Nuclear envelope completely disintegrates. Chromosomes move freely.",
  metaphase: "Chromosomes align at the cell's equator forming the metaphase plate.",
  anaphase: "Sister chromatids separate and move to opposite poles of the cell.",
  telophase: "Chromosomes decondense. Nuclear envelopes reform around each set.",
  cytokinesis: "Cytoplasm divides, creating two separate daughter cells."
};

// Utility functions
const createInitialGrid = (size: number = 5, spacing: number = 2): GridPosition[] => {
  const grid: GridPosition[] = [];

  for (let x = -size; x <= size; x++) {
    for (let y = -size; y <= size; y++) {
      for (let z = -2; z <= 2; z++) {
        grid.push({
          x: x * spacing,
          y: y * spacing,
          z: z * spacing,
          isOccupied: false
        });
      }
    }
  }

  return grid;
};

// First, let's improve the findAvailablePosition function to better distribute cells
const findAvailablePosition = (grid: GridPosition[], nearPosition?: [number, number, number]): [number, number, number] => {
  // If looking for position near another, prioritize positions that are not too close
  if (nearPosition) {
    // Sort grid by distance to the target position, but avoid immediate neighbors
    const sortedGrid = [...grid]
      .filter(pos => !pos.isOccupied)
      .filter(pos => {
        // Calculate distance from current position
        const dist = Math.sqrt(
          Math.pow(pos.x - nearPosition[0], 2) +
          Math.pow(pos.y - nearPosition[1], 2) +
          Math.pow(pos.z - nearPosition[2], 2)
        );
        // Filter positions that are neither too close nor too far
        return dist > 3 && dist < 10; // Ensure minimum separation distance
      })
      .sort((a, b) => {
        // Favor positions that better utilize the canvas space (prefer diagonal directions)
        const distA = Math.sqrt(
          Math.pow(a.x - nearPosition[0], 2) +
          Math.pow(a.y - nearPosition[1], 2) +
          Math.pow(a.z - nearPosition[2], 2)
        );
        const distB = Math.sqrt(
          Math.pow(b.x - nearPosition[0], 2) +
          Math.pow(b.y - nearPosition[1], 2) +
          Math.pow(b.z - nearPosition[2], 2)
        );
        return distA - distB;
      });

    if (sortedGrid.length > 0) {
      sortedGrid[0].isOccupied = true;
      return [sortedGrid[0].x, sortedGrid[0].y, sortedGrid[0].z];
    }
  }

  // If no specific position requested or no positions available near target
  const availablePositions = grid.filter(pos => !pos.isOccupied);

  if (availablePositions.length === 0) {
    // Create a completely new position well away from existing cells
    const quadrant = Math.floor(Math.random() * 4);
    const distance = 5 + Math.random() * 5; // Larger distance

    // Distribute in different quadrants for better space utilization
    switch (quadrant) {
      case 0: return [distance, distance, Math.random() * 3];
      case 1: return [-distance, distance, Math.random() * 3];
      case 2: return [-distance, -distance, Math.random() * 3];
      default: return [distance, -distance, Math.random() * 3];
    }
  }

  const randomIndex = Math.floor(Math.random() * availablePositions.length);
  availablePositions[randomIndex].isOccupied = true;

  return [
    availablePositions[randomIndex].x,
    availablePositions[randomIndex].y,
    availablePositions[randomIndex].z
  ];
};

// Add this elastic easing function
const calculateElasticEaseOut = (x: number): number => {
  const c4 = (2 * Math.PI) / 3;

  return x === 0
    ? 0
    : x === 1
      ? 1
      : Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * c4) + 1;
};

// Enhanced chromosome component with realistic behavior
const Chromosome = memo<{
  position: [number, number, number];
  rotation: [number, number, number];
  color: string;
  id: number;
  stage: MitosisStage;
  pairId: number;
  hasMutation: boolean;
  condensationLevel: number;
}>(({ position, rotation, color, id, stage, pairId, hasMutation, condensationLevel }) => {
  const [hovered, setHover] = useState(false);
  const meshRef = useRef<THREE.Group>(null);
  const [separationProgress, setSeparationProgress] = useState(0);
  const initialPositionRef = useRef<[number, number, number]>([position[0], position[1], position[2]]);

  useFrame((state) => {
    if (!meshRef.current) return;

    const time = state.clock.getElapsedTime();
    const initialPosition = initialPositionRef.current;

    // Stage-specific animations with smoother movements
    switch (stage) {
      case 'interphase':
        // Chromosomes diffuse, barely visible, spread throughout nucleus
        meshRef.current.scale.set(0.3, 0.3, 0.3); // Smaller during interphase
        meshRef.current.position.set(
          initialPosition[0] * 0.8 + Math.sin(time * 0.3 + id) * 0.1,
          initialPosition[1] * 0.8 + Math.cos(time * 0.2 + id) * 0.1,
          initialPosition[2] * 0.8 + Math.sin(time * 0.25 + id * 0.5) * 0.1
        );
        break;

      case 'prophase':
        // Chromosome condensation - progressively become more visible
        const condensation = THREE.MathUtils.lerp(0.5, 1.2, condensationLevel);
        meshRef.current.scale.set(
          condensation,
          condensation * 0.6,
          condensation
        );
        // More random movements as chromosomes condense and become visible
        meshRef.current.position.set(
          initialPosition[0] * 0.7 + Math.sin(time * 0.4 + id) * 0.15,
          initialPosition[1] * 0.7 + Math.cos(time * 0.3 + id) * 0.15,
          initialPosition[2] * 0.7 + Math.sin(time * 0.35 + id) * 0.1
        );
        break;

      case 'prometaphase':
        // Nuclear envelope breakdown, chromosomes move more erratically
        meshRef.current.scale.set(1, 0.8, 1); // Fully condensed

        // More dramatic random movements as they search for kinetochore attachments
        const searchAmplitude = 0.3;
        meshRef.current.position.x = initialPosition[0] + Math.sin(time * 2.5 + id * 5) * searchAmplitude;
        meshRef.current.position.y = initialPosition[1] + Math.cos(time * 2 + id * 3) * searchAmplitude;
        meshRef.current.position.z = initialPosition[2] + Math.sin(time * 1.5 + id) * (searchAmplitude * 0.5);
        break;

      case 'metaphase':
        // Precise alignment at metaphase plate
        meshRef.current.scale.set(1, 0.8, 1);

        // Small oscillations at the metaphase plate showing microtubule tension
        const oscillation = Math.sin(time * 1.2 + id * 0.5) * 0.03;
        meshRef.current.position.set(
          THREE.MathUtils.lerp(meshRef.current.position.x, oscillation, 0.1),
          THREE.MathUtils.lerp(meshRef.current.position.y, 0, 0.1), // Precisely at y=0 (equator)
          THREE.MathUtils.lerp(meshRef.current.position.z, initialPosition[2] * 0.3, 0.05)
        );
        break;

      case 'anaphase':
        // Sister chromatid separation - move to opposite poles smoothly
        const separation = THREE.MathUtils.lerp(separationProgress, 1, 0.02);
        setSeparationProgress(separation);
        const direction = pairId % 2 === 0 ? 1 : -1;
        const targetY = direction * separation * 1.5; // More pronounced separation

        meshRef.current.scale.set(0.9, 0.7, 0.9);
        // Smoother movement to poles
        meshRef.current.position.x = THREE.MathUtils.lerp(meshRef.current.position.x, 0, 0.05); // Center on x-axis
        meshRef.current.position.y = THREE.MathUtils.lerp(meshRef.current.position.y, targetY, 0.04); // Slower, smoother separation
        meshRef.current.position.z = THREE.MathUtils.lerp(meshRef.current.position.z, 0, 0.05); // Center on z-axis
        break;

      case 'telophase':
        // Movement to poles complete and decondensation begins
        const decondense = THREE.MathUtils.lerp(0.8, 0.5, Math.sin(time * 0.5) * 0.5 + 0.5); // Progressive decondensation
        meshRef.current.scale.set(decondense, decondense * 0.8, decondense);

        // Fixed at poles
        const poleDirection = pairId % 2 === 0 ? 1 : -1;
        meshRef.current.position.x = Math.sin(time * 0.3 + id) * 0.1; // Small movement at pole
        meshRef.current.position.y = poleDirection * 1.8; // Further spread at poles
        meshRef.current.position.z = Math.cos(time * 0.3 + id) * 0.1; // Small movement at pole
        break;

      case 'cytokinesis':
        // Complete decondensation into two nuclei
        const finalDecondense = 0.4 + Math.sin(time * 0.2) * 0.1; // Smallest as they fully decondense
        meshRef.current.scale.set(finalDecondense, finalDecondense, finalDecondense);

        // Fixed in daughter cells nuclei
        const finalPoleDirection = pairId % 2 === 0 ? 1 : -1;
        meshRef.current.position.x = Math.sin(time * 0.2 + id) * 0.15; // More diffuse in nucleus
        meshRef.current.position.y = finalPoleDirection * 2.0; // Complete separation
        meshRef.current.position.z = Math.cos(time * 0.2 + id) * 0.15; // More diffuse in nucleus
        break;
    }

    // Mutation effects
    if (hasMutation) {
      meshRef.current.rotation.z += 0.01;
      const mutationGlow = Math.sin(time * 4) * 0.5 + 0.5;
      const mutationScale = 1 + mutationGlow * 0.1;
      meshRef.current.scale.multiplyScalar(mutationScale);
    }
  });

  return (
    <group
      ref={meshRef}
      position={position}
      rotation={rotation}
      onPointerOver={() => setHover(true)}
      onPointerOut={() => setHover(false)}
    >
      {/* Sister Chromatid 1 */}
      <mesh position={[-0.03, 0, 0]}>
        <cylinderGeometry args={[0.04, 0.05, 0.35, 16]} />
        <meshPhysicalMaterial
          color={hasMutation ? '#ff6b6b' : color}
          emissive={hasMutation ? '#ff0000' : new THREE.Color(color).multiplyScalar(0.2)}
          emissiveIntensity={hovered || hasMutation ? 0.8 : 0.3}
          metalness={0.3}
          roughness={0.4}
          clearcoat={1}
          clearcoatRoughness={0.1}
        />
      </mesh>

      {/* Sister Chromatid 2 */}
      <mesh position={[0.03, 0, 0]}>
        <cylinderGeometry args={[0.04, 0.05, 0.35, 16]} />
        <meshPhysicalMaterial
          color={hasMutation ? '#ff6b6b' : color}
          emissive={hasMutation ? '#ff0000' : new THREE.Color(color).multiplyScalar(0.2)}
          emissiveIntensity={hovered || hasMutation ? 0.8 : 0.3}
          metalness={0.3}
          roughness={0.4}
          clearcoat={1}
          clearcoatRoughness={0.1}
        />
      </mesh>

      {/* Centromere - improved */}
      <mesh position={[0, 0, 0]}>
        <sphereGeometry args={[0.06, 24, 24]} />
        <meshPhysicalMaterial
          color={new THREE.Color(color).multiplyScalar(0.7)}
          emissive={new THREE.Color(color).multiplyScalar(0.4)}
          emissiveIntensity={hovered ? 1 : 0.5}
          metalness={0.7}
          roughness={0.2}
          clearcoat={0.8}
        />
      </mesh>

      {/* More detailed kinetochore proteins */}
      <mesh position={[0, 0.02, 0]}>
        <boxGeometry args={[0.1, 0.025, 0.025]} />
        <meshStandardMaterial color="#ff9500" emissive="#ff9500" emissiveIntensity={0.5} />
      </mesh>

      {/* DNA coiling visualization - enhanced */}
      {Array.from({ length: 12 }, (_, i) => {
        const y = -0.13 + (i * 0.022);
        const spiralOffset = Math.sin(i * 0.8) * 0.015;
        return (
          <group key={`dna-coil-${id}-${i}`}>  {/* Using a composite key instead of just index */}
            <mesh position={[-0.03 + spiralOffset, y, 0.018]}>
              <sphereGeometry args={[0.008, 8, 8]} />
              <meshStandardMaterial
                color={new THREE.Color(color).multiplyScalar(1.4)}
                emissive={new THREE.Color(color).multiplyScalar(0.3)}
              />
            </mesh>
            <mesh position={[0.03 - spiralOffset, y, -0.018]}>
              <sphereGeometry args={[0.008, 8, 8]} />
              <meshStandardMaterial
                color={new THREE.Color(color).multiplyScalar(1.4)}
                emissive={new THREE.Color(color).multiplyScalar(0.3)}
              />
            </mesh>
          </group>
        );
      })}

      {/* Hover label */}
      {/* {hovered && (
        <Html position={[0, 0.3, 0]} center>
          <div className="chromosome-label">
            <div>Chromosome {id + 1}</div>
            {hasMutation && <div className="mutation-indicator">MUTATION</div>}
          </div>
        </Html>
      )} */}
    </group>
  );
});

Chromosome.displayName = "Chromosome";

// Enhanced nucleus with realistic behavior
const Nucleus = memo<{
  position: [number, number, number];
  radius?: number;
  stage: MitosisStage;
  onClick?: () => void;
}>(({ position, radius = 0.9, stage, onClick }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const [opacity, setOpacity] = useState(1);

  useFrame(() => {
    // Skip updates if we shouldn't render the nucleus or it's not ready
    if (!meshRef.current ||
      stage === 'prometaphase' ||
      stage === 'metaphase' ||
      stage === 'anaphase') return;

    // Nuclear envelope breakdown/reformation
    let targetOpacity = 1;
    switch (stage) {
      case 'prophase':
        targetOpacity = 0.7;
        break;
      case 'telophase':
        targetOpacity = 0.8;
        break;
      case 'cytokinesis':
        targetOpacity = 1;
        break;
    }

    setOpacity(THREE.MathUtils.lerp(opacity, targetOpacity, 0.05));

    if (meshRef.current.material instanceof THREE.MeshPhysicalMaterial) {
      meshRef.current.material.opacity = opacity;
    }
  });

  // Don't render nucleus during stages when nuclear envelope is completely broken down
  if (stage === 'prometaphase' || stage === 'metaphase' || stage === 'anaphase') {
    return null;
  }

  return (
    <mesh ref={meshRef} position={position} onClick={onClick}>
      <sphereGeometry args={[radius, 64, 64]} />
      <meshPhysicalMaterial
        color="#0088ff" // Brighter blue color
        transparent={true}
        opacity={opacity}
        metalness={0.2}
        roughness={0.6}
        transmission={0.5}
        thickness={0.3}
        envMapIntensity={0.8}
        emissive="#0044aa"
        emissiveIntensity={0.2}
      />
    </mesh>
  );
});

Nucleus.displayName = "Nucleus";

// Enhanced cell membrane with proper spherical division
const CellMembrane = memo<{
  position: [number, number, number];
  radius?: number;
  stage: MitosisStage;
}>(({ position, radius = 1.3, stage }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const clonedMeshRef = useRef<THREE.Mesh | null>(null);
  const [divisionProgress, setDivisionProgress] = useState(0);
  const groupRef = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (!groupRef.current) return;

    const time = state.clock.getElapsedTime();

    // Early stages - single cell with gentle pulsing
    if (stage === 'interphase' || stage === 'prophase' || stage === 'prometaphase' || stage === 'metaphase') {
      // Remove second cell if it exists
      if (clonedMeshRef.current && clonedMeshRef.current.parent) {
        clonedMeshRef.current.parent.remove(clonedMeshRef.current);
        clonedMeshRef.current = null;
      }

      // Reset division progress
      setDivisionProgress(0);

      // Simple breathing animation
      if (meshRef.current) {
        const breathe = 1 + Math.sin(time * 0.8) * 0.02;
        meshRef.current.scale.set(breathe, breathe, breathe);
        meshRef.current.position.set(0, 0, 0);
      }
    }
    // Begin elongation in preparation for division
    else if (stage === 'anaphase') {
      if (meshRef.current) {
        const elongation = 1 + Math.min(0.2, divisionProgress * 0.4);
        meshRef.current.scale.set(1, elongation, 1);
        meshRef.current.position.set(0, 0, 0);

        // Start slight progression of division
        setDivisionProgress(Math.min(0.3, divisionProgress + 0.005));
      }
    }
    // Begin forming two distinct spheres
    else if (stage === 'telophase') {
      // Create second cell if it doesn't exist
      if (!clonedMeshRef.current && meshRef.current) {
        const clonedMesh = meshRef.current.clone();
        clonedMeshRef.current = clonedMesh;
        if (groupRef.current) {
          groupRef.current.add(clonedMeshRef.current);
        }
      }

      // Progress the division
      setDivisionProgress(Math.min(0.8, divisionProgress + 0.01));

      const progress = THREE.MathUtils.smoothstep(divisionProgress, 0, 1);
      const separation = progress * 1.2; // Distance between cell centers

      // Update shapes and positions
      if (meshRef.current) {
        // Size reduction as cells separate
        const scale = 0.9 - divisionProgress * 0.2;
        meshRef.current.scale.set(scale, scale, scale);
        meshRef.current.position.set(0, separation, 0);
      }

      if (clonedMeshRef.current) {
        const scale = 0.9 - divisionProgress * 0.2;
        clonedMeshRef.current.scale.set(scale, scale, scale);
        clonedMeshRef.current.position.set(0, -separation, 0);
      }
    }
    // Complete separation into two distinct cells
    else if (stage === 'cytokinesis') {
      // Progress the division to completion
      setDivisionProgress(Math.min(1, divisionProgress + 0.01));

      const separation = divisionProgress * 1.5; // Increased distance for final separation

      if (meshRef.current) {
        // Final adjustment of cell size
        const finalScale = 0.85;
        meshRef.current.scale.set(finalScale, finalScale, finalScale);
        meshRef.current.position.set(0, separation, 0);
      }

      if (clonedMeshRef.current) {
        const finalScale = 0.85;
        clonedMeshRef.current.scale.set(finalScale, finalScale, finalScale);
        clonedMeshRef.current.position.set(0, -separation, 0);
      }
    }
  });

  return (
    <group ref={groupRef}>
      <mesh ref={meshRef} position={[0, 0, 0]}>
        <sphereGeometry args={[radius, 64, 64]} />
        <meshPhysicalMaterial
          color="#ffffff"
          transparent={true}
          opacity={0.2}
          side={THREE.DoubleSide}
          transmission={0.85}
          thickness={0.05}
          roughness={0.2}
          metalness={0.1}
          clearcoat={0.3}
        />
      </mesh>
    </group>
  );
});

CellMembrane.displayName = "CellMembrane";

// Spindle apparatus component with enhanced biological accuracy
const SpindleApparatus = memo<{
  stage: MitosisStage;
  chromosomes: ChromosomeData[];
}>(({ stage, chromosomes }) => {
  const spindleRef = useRef<THREE.Group>(null);

  // No spindle apparatus visible during interphase
  if (stage === 'interphase') return null;

  // Calculate centrosome positions based on stage
  let topPolePosition: [number, number, number] = [0, 0, 0];
  let bottomPolePosition: [number, number, number] = [0, 0, 0];

  // Dynamic positioning based on mitotic stage
  switch (stage) {
    case 'prophase':
      // Centrosomes beginning to migrate to opposite poles
      topPolePosition = [0, 0.6, 0];
      bottomPolePosition = [0, -0.6, 0];
      break;
    case 'prometaphase':
      // Centrosomes at opposite poles, full spindle formation
      topPolePosition = [0, 1.0, 0];
      bottomPolePosition = [0, -1.0, 0];
      break;
    case 'metaphase':
      // Stable spindle formation
      topPolePosition = [0, 1.2, 0];
      bottomPolePosition = [0, -1.2, 0];
      break;
    case 'anaphase':
      // Poles slightly further apart as cell elongates
      topPolePosition = [0, 1.5, 0];
      bottomPolePosition = [0, -1.5, 0];
      break;
    case 'telophase':
    case 'cytokinesis':
      // Maximum separation for cell division
      topPolePosition = [0, 1.8, 0];
      bottomPolePosition = [0, -1.8, 0];
      break;
  }

  // Number of astral rays and microtubules varies by stage
  const astralRayCount = stage === 'prophase' ? 8 : 16;
  const polarMicrotubuleCount =
    stage === 'prophase' ? 12 :
      stage === 'telophase' || stage === 'cytokinesis' ? 8 : 24;

  return (
    <group ref={spindleRef}>
      {/* Centrosomes - enhance with stage-specific visibility */}
      <group position={topPolePosition}>
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.07, 0.07, 0.4, 16]} />
          <meshStandardMaterial
            color="#ff2d92"
            emissive="#ff2d92"
            emissiveIntensity={stage === 'metaphase' ? 0.9 : 0.7}
          />
        </mesh>
        <mesh position={[0, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.07, 0.07, 0.4, 16]} />
          <meshStandardMaterial
            color="#ff2d92"
            emissive="#ff2d92"
            emissiveIntensity={stage === 'metaphase' ? 0.9 : 0.7}
          />
        </mesh>

        {/* Astral rays - more pronounced during metaphase */}
        {Array.from({ length: astralRayCount }, (_, i) => {
          const angle = (i / astralRayCount) * Math.PI * 2;
          const length = 0.3 + Math.random() * 0.2;
          return (
            <mesh key={`top-astral-${stage}-${i}`} position={[
              Math.cos(angle) * 0.1,
              Math.sin(angle) * 0.1,
              0
            ]} rotation={[0, 0, angle]}>
              <cylinderGeometry args={[0.002, 0.001, length, 4]} />
              <meshBasicMaterial
                color="#ff9fef"
                transparent
                opacity={stage === 'telophase' || stage === 'cytokinesis' ? 0.3 : 0.7}
              />
            </mesh>
          );
        })}
      </group>

      {/* Bottom centrosome */}
      <group position={bottomPolePosition}>
        {/* Same structure as top centrosome */}
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.07, 0.07, 0.4, 16]} />
          <meshStandardMaterial
            color="#ff2d92"
            emissive="#ff2d92"
            emissiveIntensity={stage === 'metaphase' ? 0.9 : 0.7}
          />
        </mesh>
        <mesh position={[0, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.07, 0.07, 0.4, 16]} />
          <meshStandardMaterial
            color="#ff2d92"
            emissive="#ff2d92"
            emissiveIntensity={stage === 'metaphase' ? 0.9 : 0.7}
          />
        </mesh>

        {/* Astral rays */}
        {Array.from({ length: astralRayCount }, (_, i) => {
          const angle = (i / astralRayCount) * Math.PI * 2;
          const length = 0.3 + Math.random() * 0.2;
          return (
            <mesh key={`bottom-astral-${i}`} position={[
              Math.cos(angle) * 0.1,
              Math.sin(angle) * 0.1,
              0
            ]} rotation={[0, 0, angle]}>
              <cylinderGeometry args={[0.002, 0.001, length, 4]} />
              <meshBasicMaterial
                color="#ff9fef"
                transparent
                opacity={stage === 'telophase' || stage === 'cytokinesis' ? 0.3 : 0.7}
              />
            </mesh>
          );
        })}
      </group>

      {/* Kinetochore microtubules - enhanced to show attachment dynamics */}
      {stage !== 'prophase' && chromosomes.map((chrom) => {
        // Stage-specific microtubule connections
        let leftConnection = true;
        let rightConnection = true;

        // In anaphase and telophase, each chromosome connects to just one pole
        if (stage === 'anaphase' || stage === 'telophase' || stage === 'cytokinesis') {
          leftConnection = chrom.pairId % 2 !== 0;
          rightConnection = chrom.pairId % 2 === 0;
        }

        // Microtubule thickness varies by stage
        const tubuleThickness =
          stage === 'prometaphase' ? 0.003 :
            stage === 'metaphase' ? 0.006 : 0.004;

        // Microtubule tension/straightness varies by stage  
        const controlPointFactor =
          stage === 'metaphase' ? 0.8 :
            stage === 'anaphase' ? 0.6 : 0.4;

        return (
          <React.Fragment key={`chrom-connections-${chrom.id}`}>
            {/* Left pole to chromosome */}
            {leftConnection && (
              <mesh key={`top-conn-${chrom.id}`}>
                <tubeGeometry
                  args={[
                    new THREE.CatmullRomCurve3([
                      new THREE.Vector3(...topPolePosition),
                      new THREE.Vector3(
                        (topPolePosition[0] + chrom.position[0]) * controlPointFactor,
                        (topPolePosition[1] + chrom.position[1]) * controlPointFactor,
                        (topPolePosition[2] + chrom.position[2]) * 0.5
                      ),
                      new THREE.Vector3(...chrom.position)
                    ]),
                    20,  // tubular segments
                    tubuleThickness,
                    8,    // radial segments
                    false // closed
                  ]}
                />
                <meshBasicMaterial
                  color={stage === 'metaphase' ? "#00ffff" : "#00ddff"}
                  transparent
                  opacity={stage === 'telophase' || stage === 'cytokinesis' ? 0.3 : 0.7}
                />
              </mesh>
            )}

            {/* Right pole to chromosome */}
            {rightConnection && (
              <mesh key={`bottom-conn-${chrom.id}`}>
                <tubeGeometry
                  args={[
                    new THREE.CatmullRomCurve3([
                      new THREE.Vector3(...bottomPolePosition),
                      new THREE.Vector3(
                        (bottomPolePosition[0] + chrom.position[0]) * controlPointFactor,
                        (bottomPolePosition[1] + chrom.position[1]) * controlPointFactor,
                        (bottomPolePosition[2] + chrom.position[2]) * 0.5
                      ),
                      new THREE.Vector3(...chrom.position)
                    ]),
                    20,  // tubular segments
                    tubuleThickness,
                    8,    // radial segments
                    false // closed
                  ]}
                />
                <meshBasicMaterial
                  color={stage === 'metaphase' ? "#00ffff" : "#00ddff"}
                  transparent
                  opacity={stage === 'telophase' || stage === 'cytokinesis' ? 0.3 : 0.7}
                />
              </mesh>
            )}
          </React.Fragment>
        );
      })}

      {/* Polar microtubules - vary by stage */}
      {Array.from({ length: polarMicrotubuleCount }, (_, i) => {
        const offset = [
          (Math.random() - 0.5) * 0.2,
          (Math.random() - 0.5) * 0.2,
          (Math.random() - 0.5) * 0.2
        ];

        // Curved microtubules during metaphase for better tension visualization
        const curveFactor = stage === 'metaphase' ? 0.3 : 0.1;

        return (
          <mesh key={`polar-mt-${stage}-${i}`}>
            <tubeGeometry
              args={[
                new THREE.CatmullRomCurve3([
                  new THREE.Vector3(
                    topPolePosition[0] + offset[0] * 0.5,
                    topPolePosition[1] + offset[1],
                    topPolePosition[2] + offset[2]
                  ),
                  new THREE.Vector3(
                    offset[0] * curveFactor,
                    (topPolePosition[1] + bottomPolePosition[1]) / 2 + offset[1] * curveFactor,
                    offset[2] * curveFactor
                  ),
                  new THREE.Vector3(
                    bottomPolePosition[0] + offset[0] * 0.5,
                    bottomPolePosition[1] + offset[1],
                    bottomPolePosition[2] + offset[2]
                  )
                ]),
                20,
                0.002,
                6,
                false
              ]}
            />
            <meshBasicMaterial
              color={stage === 'metaphase' ? "#fffd80" : "#ffea00"}
              transparent
              opacity={stage === 'telophase' || stage === 'cytokinesis' ? 0.2 : 0.5}
            />
          </mesh>
        );
      })}
    </group>
  );
});

SpindleApparatus.displayName = "SpindleApparatus";

// Enhanced cell component with smooth position transitions
const EnhancedCell = memo<{
  cellData: CellData;
  onSelect: (cellId: number) => void;
  isSelected: boolean;
  simulationSpeed: number;
}>(({ cellData, onSelect, isSelected, simulationSpeed }) => {
  const [chromosomes, setChromosomes] = useState<ChromosomeData[]>([]);
  const cellRef = useRef<THREE.Group>(null);
  const [separationProgress, setSeparationProgress] = useState(0);

  // Store the previous position for smooth transitions
  const previousPositionRef = useRef<[number, number, number]>(cellData.position);
  const transitionProgressRef = useRef<number>(1); // 1 means transition complete

  // Initialize chromosomes with unique IDs
  useEffect(() => {
    // Force new chromosome generation on reset
    if (cellData.isReset) {
      const newChromosomes: ChromosomeData[] = [];

      for (let i = 0; i < 8; i++) {
        const color = CHROMOSOME_COLORS[i % CHROMOSOME_COLORS.length];
        const angle = (i / 8) * Math.PI * 2;
        const distance = 0.4; // Initial state positioning

        newChromosomes.push({
          id: cellData.id * 100 + i,
          color,
          position: [
            Math.cos(angle) * distance,
            Math.sin(angle) * distance,
            (Math.random() - 0.5) * 0.1
          ],
          rotation: [Math.PI / 2, 0, angle],
          pairId: Math.floor(i / 2),
          hasMutation: false, // Always set to false since we're removing this feature
          condensationLevel: 0.3 // Initial state condensation
        });
      }

      setChromosomes(newChromosomes);
      // Reset transition state and make sure to reset position references
      transitionProgressRef.current = 1;
      previousPositionRef.current = [...cellData.position]; // Clone to avoid reference issues

      // Important: Reset the group position to match the cell data position
      if (cellRef.current) {
        cellRef.current.position.set(
          cellData.position[0],
          cellData.position[1],
          cellData.position[2]
        );
        cellRef.current.scale.set(1, 1, 1);
      }

      // Reset separation progress in chromosomes
      setSeparationProgress(0);
      return;
    }

    // Regular chromosome initialization for non-reset cells
    const newChromosomes: ChromosomeData[] = [];

    for (let i = 0; i < 8; i++) {
      const color = CHROMOSOME_COLORS[i % CHROMOSOME_COLORS.length];
      const angle = (i / 8) * Math.PI * 2;
      let distance = 0.4;

      // Position based on stage
      if (cellData.stage === 'metaphase') distance = 0.1;
      if (cellData.stage === 'anaphase') distance = 0.7;

      newChromosomes.push({
        id: cellData.id * 100 + i, // Create globally unique IDs by combining cell ID and chromosome index
        color,
        position: [
          Math.cos(angle) * distance,
          Math.sin(angle) * distance,
          (Math.random() - 0.5) * 0.1
        ],
        rotation: [Math.PI / 2, 0, angle],
        pairId: Math.floor(i / 2),
        hasMutation: false, // Always set to false since we're removing this feature
        condensationLevel: cellData.stage === 'prophase' ? 0.8 : 0.3
      });
    }

    setChromosomes(newChromosomes);
  }, [cellData.stage, cellData.id, cellData.isReset]);

  // Animation based on stage with smooth position transitions
  useFrame((state) => {
    if (!cellRef.current) return;

    const time = state.clock.getElapsedTime() * simulationSpeed;

    // Handle position transitions with improved smoothness
    if (
      previousPositionRef.current[0] !== cellData.position[0] ||
      previousPositionRef.current[1] !== cellData.position[1] ||
      previousPositionRef.current[2] !== cellData.position[2]
    ) {
      // Position has changed, start a new transition
      if (transitionProgressRef.current >= 1) {
        previousPositionRef.current = [
          cellRef.current.position.x,
          cellRef.current.position.y,
          cellRef.current.position.z
        ];
        transitionProgressRef.current = 0;
      }
    }

    // Progress the transition with improved easing
    if (transitionProgressRef.current < 1) {
      // Slower at start, faster at end (better for cell separation)
      transitionProgressRef.current += 0.01 * simulationSpeed * (1 + transitionProgressRef.current * 2);

      // Advanced easing function for smoother, more natural movement
      // This is an elastic ease-out function that gives a slight bounce effect
      const easeProgress = calculateElasticEaseOut(Math.min(transitionProgressRef.current, 1));

      // Interpolate position with the easing function
      cellRef.current.position.x = THREE.MathUtils.lerp(
        previousPositionRef.current[0],
        cellData.position[0],
        easeProgress
      );
      cellRef.current.position.y = THREE.MathUtils.lerp(
        previousPositionRef.current[1],
        cellData.position[1],
        easeProgress
      );
      cellRef.current.position.z = THREE.MathUtils.lerp(
        previousPositionRef.current[2],
        cellData.position[2],
        easeProgress
      );

      // Animate scale during transition for cell division effect
      if (cellData.stage === 'interphase' && transitionProgressRef.current < 0.5) {
        const growFactor = 0.8 + transitionProgressRef.current * 0.4;
        cellRef.current.scale.set(growFactor, growFactor, growFactor);
      }
    } else {
      // Subtle breathing animation when not transitioning
      const breathe = 1 + Math.sin(time * 0.5) * 0.02;
      cellRef.current.scale.set(breathe, breathe, breathe);
    }
  });

  const handleCellClick = useCallback(() => {
    onSelect(cellData.id);
  }, [cellData.id, onSelect]);

  return (
    <group
      ref={cellRef}
      position={cellData.position}
      onClick={handleCellClick}
    >
      <CellMembrane position={[0, 0, 0]} stage={cellData.stage} />
      {/* Nucleus component removed */}

      <SpindleApparatus stage={cellData.stage} chromosomes={chromosomes} />

      {/* Chromosomes */}
      {chromosomes.map((chrom) => (
        <Chromosome
          key={chrom.id}
          {...chrom}
          stage={cellData.stage}
        />
      ))}
    </group>
  );
});

EnhancedCell.displayName = "EnhancedCell";

// Main simulation scene with fixed key generation - simplified
const MitosisScene = memo<{
  cells: CellData[];
  selectedCellId: number | null;
  onCellSelect: (cellId: number) => void;
  simulationSpeed: number;
}>(({ cells, selectedCellId, onCellSelect, simulationSpeed }) => {
  return (
    <group>
      {cells.map((cell) => (
        <EnhancedCell
          // Add timestamp to key to guarantee uniqueness
          key={`cell-${cell.id}-${cell.isReset ? 'reset' : 'normal'}`}
          cellData={cell}
          onSelect={onCellSelect}
          isSelected={selectedCellId === cell.id}
          simulationSpeed={simulationSpeed}
        />
      ))}
    </group>
  );
});

MitosisScene.displayName = "MitosisScene";

// Simplified analytics panel that only shows success rate
const SimplifiedAnalyticsPanel: React.FC<{
  successRate: number;
  totalAttempts: number;
  successfulDivisions: number;
}> = ({ successRate, totalAttempts, successfulDivisions }) => {
  return (
    <div className="analytics-panel" role="region" aria-label="Analytics">
      <h3 className="panel-title">🧬 Mitosis Statistics</h3>

      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-value">{successRate.toFixed(1)}%</div>
          <div className="metric-label">Success Rate</div>
        </div>

        <div className="metric-card">
          <div className="metric-value">{successfulDivisions}/{totalAttempts}</div>
          <div className="metric-label">Successful Divisions</div>
        </div>
      </div>
    </div>
  );
};

// Simplified AdvancedControlsPanel without mutations, performance stats, and export features
const AdvancedControlsPanel: React.FC<{
  isPlaying: boolean;
  setIsPlaying: (playing: boolean) => void;
  simulationSpeed: number;
  setSimulationSpeed: (speed: number) => void;
  onReset: () => void;
}> = ({
  isPlaying,
  setIsPlaying,
  simulationSpeed,
  setSimulationSpeed,
  onReset
}) => {
    return (
      <div className="controls-panel" role="region" aria-label="Simulation Controls">
        <h3 className="panel-title">🎮 Simulation Controls</h3>

        <div className="control-section">
          <div className="control-row">
            <button
              className={`control-btn primary ${isPlaying ? 'active' : ''}`}
              onClick={() => setIsPlaying(!isPlaying)}
              aria-label={isPlaying ? 'Pause simulation' : 'Play simulation'}
            >
              {isPlaying ? '⏸️ Pause' : '▶️ Play'}
            </button>

            <button
              className="control-btn secondary"
              onClick={onReset}
              aria-label="Reset simulation"
            >
              🔄 Reset
            </button>
          </div>

          <div className="slider-control">
            <label htmlFor="speed-slider">Simulation Speed: {simulationSpeed.toFixed(1)}x</label>
            <input
              id="speed-slider"
              type="range"
              min="0.1"
              max="3"
              step="0.1"
              value={simulationSpeed}
              onChange={(e) => setSimulationSpeed(parseFloat(e.target.value))}
              className="speed-slider"
              aria-label="Set simulation speed"
            />
          </div>
        </div>
      </div>
    );
  };

// Enhanced cell information panel
const CellInformationPanel: React.FC<{
  selectedCell: CellData | null;
}> = ({ selectedCell }) => {
  if (!selectedCell) {
    return (
      <div className="info-panel" role="region" aria-label="Cell Information">
        <h3 className="panel-title">📋 Cell Information</h3>
        <p className="no-selection">Click on a cell to view detailed information</p>
      </div>
    );
  }

  return (
    <div className="info-panel" role="region" aria-label="Cell Information">
      <h3 className="panel-title">📋 Cell #{selectedCell.id}</h3>

      <div className="cell-overview">
        <div className={`stage-badge ${selectedCell.mitosisFailed ? 'failed' : ''}`}>
          {selectedCell.stage.toUpperCase()}
          {selectedCell.mitosisFailed && ' (FAILED)'}
        </div>
        <div className="progress-bar" role="progressbar" aria-valuenow={selectedCell.divisionProgress * 100} aria-valuemin={0} aria-valuemax={100}>
          <div
            className="progress-fill"
            style={{ width: `${selectedCell.divisionProgress * 100}%` }}
          />
        </div>
      </div>

      <div className="cell-stats">
        <div className="stat-item">
          <span className="stat-label">Age:</span>
          <span className="stat-value">{selectedCell.age} cycles</span>
        </div>

        {selectedCell.mitosisFailed && (
          <div className="stat-item">
            <span className="stat-label">Status:</span>
            <span className="stat-value failed-text">Division Failed</span>
          </div>
        )}
      </div>

      <div className="stage-description">
        <h4>Current Stage</h4>
        <p>{STAGE_DESCRIPTIONS[selectedCell.stage]}</p>
        {selectedCell.mitosisFailed && (
          <p className="failed-text">Mitosis has failed at anaphase. This cell cannot complete division.</p>
        )}
      </div>
    </div>
  );
};

// Educational tooltip component
const EducationalTooltip: React.FC<{
  isOpen: boolean;
  onClose: () => void;
}> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="tooltip-overlay">
      <div className="tooltip-content">
        <button className="tooltip-close" onClick={onClose} aria-label="Close tooltip">×</button>
        <h3>About Mitosis</h3>
        <p>
          Mitosis is a process where a single cell divides into two identical daughter cells.
          During this process, replicated chromosomes are separated into two new nuclei.
        </p>
        <h4>Stages of Mitosis:</h4>
        <ul>
          {Object.entries(STAGE_DESCRIPTIONS).map(([stage, description]) => (
            <li key={stage}>
              <strong>{stage.charAt(0).toUpperCase() + stage.slice(1)}:</strong> {description}
            </li>
          ))}
        </ul>
        <p>
          Use the controls to adjust the simulation speed and observe how cells
          progress through the different stages of mitosis.
        </p>
      </div>
    </div>
  );
};

// Loading screen component
const LoadingScreen: React.FC = () => {
  return (
    <div className="loading-screen">
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <h2>Loading Mitosis Simulation...</h2>
        <p>Preparing cellular environment</p>
      </div>
    </div>
  );
};

// Main component with cell ID counter - simplified
const ImmersiveMitosisLab: React.FC = () => {
  // State variables
  const [totalAttempts, setTotalAttempts] = useState(0);
  const [successfulDivisions, setSuccessfulDivisions] = useState(0);
  const [successRate, setSuccessRate] = useState(0);
  const nextCellIdRef = useRef<number>(2);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [simulationSpeed, setSimulationSpeed] = useState<number>(1);
  const [showTooltip, setShowTooltip] = useState<boolean>(false);
  const [selectedCellId, setSelectedCellId] = useState<number | null>(null);
  const [grid, setGrid] = useState<GridPosition[]>(createInitialGrid());
  const [isLoading, setIsLoading] = useState<boolean>(true); // Add loading state

  // Initial cell
  const [cells, setCells] = useState<CellData[]>([
    {
      id: 1,
      position: [0, 0, 0],
      stage: 'interphase',
      divisionProgress: 0.1,
      mutationLevel: 0,
      age: 3
    }
  ]);

  // Handle initial loading
  useEffect(() => {
    // Simulate asset loading with a timeout
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 2000);

    return () => clearTimeout(timer);
  }, []);

  // Now we can safely reference cells in useMemo
  const selectedCell = useMemo(() =>
    cells.find(cell => cell.id === selectedCellId) || null
    , [cells, selectedCellId]);

  // Add the updateGridOccupancy function
  const updateGridOccupancy = useCallback((cellPositions: [number, number, number][]) => {
    setGrid(prevGrid => {
      // Reset all positions to unoccupied
      const newGrid = prevGrid.map(pos => ({ ...pos, isOccupied: false }));

      // Mark cell positions as occupied
      cellPositions.forEach(([x, y, z]) => {
        const gridPos = newGrid.find(pos =>
          Math.abs(pos.x - x) < 0.5 &&
          Math.abs(pos.y - y) < 0.5 &&
          Math.abs(pos.z - z) < 0.5
        );

        if (gridPos) {
          gridPos.isOccupied = true;
        }
      });

      return newGrid;
    });
  }, []);

  // Add handlers for UI actions
  const handleCellSelect = useCallback((cellId: number) => {
    setSelectedCellId(cellId);
  }, []);

  const handleReset = useCallback(() => {
    setCells([{
      id: 1,
      position: [0, 0, 0],
      stage: 'interphase',
      divisionProgress: 0,
      mutationLevel: 0,
      age: 0,
      isReset: true
    }]);
    nextCellIdRef.current = 2;
    setGrid(createInitialGrid());
    setSelectedCellId(null);

    // Reset success statistics
    setTotalAttempts(0);
    setSuccessfulDivisions(0);
    setSuccessRate(0); // Reset to initial rate of 0
  }, []);

  // Delete this function
  const handleExport = useCallback(() => {
    const exportData = {
      timestamp: new Date().toISOString(),
      cells: cells.map(cell => ({
        id: cell.id,
        stage: cell.stage,
        age: cell.age,
        mutations: cell.mutationLevel
      }))
    };

    // Create a downloadable file
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mitosis-data-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [cells]);

  const getNextCellId = useCallback(() => {
    const nextId = nextCellIdRef.current;
    nextCellIdRef.current += 1;
    return nextId;
  }, []);

  // Update the useEffect that handles cell division
  useEffect(() => {
    if (!isPlaying) return;

    const interval = setInterval(() => {
      setCells(prev => {
        let newCells: CellData[] = [];

        // Process each cell
        prev.forEach(cell => {
          const stages: MitosisStage[] = ['interphase', 'prophase', 'prometaphase', 'metaphase', 'anaphase', 'telophase', 'cytokinesis'];
          const currentIndex = stages.indexOf(cell.stage);
          const nextProgress = cell.divisionProgress + (simulationSpeed * 0.03);

          // Skip updates for cells that failed mitosis and remain in anaphase
          if (cell.mitosisFailed) {
            newCells.push(cell);
            return;
          }

          if (nextProgress >= 1) {
            // Check for mitosis success when entering anaphase
            if (stages[currentIndex] === 'metaphase' && stages[(currentIndex + 1) % stages.length] === 'anaphase') {
              // Always succeed for first two attempts, then 80% success rate (20% failure)
              const isSuccessful = totalAttempts < 2 ? true : Math.random() < 0.8;

              if (!isSuccessful) {
                // Update stats for failed mitosis
                setTotalAttempts(prev => prev + 1);
                const newSuccessRate = totalAttempts === 0 ? 0 : (successfulDivisions / (totalAttempts + 1) * 100);
                setSuccessRate(newSuccessRate);

                // Cell fails at anaphase
                newCells.push({
                  ...cell,
                  stage: 'anaphase',
                  divisionProgress: 0,
                  mitosisFailed: true, // Mark as failed
                });
                return;
              }
            }

            // Move to next stage when progress reaches 100%
            const nextStage = stages[(currentIndex + 1) % stages.length];

            // Create a single new daughter cell when cytokinesis completes
            if (nextStage === 'interphase' && cell.stage === 'cytokinesis') {
              // Update success rate stats
              setTotalAttempts(prev => prev + 1);
              setSuccessfulDivisions(prev => prev + 1);
              const newSuccessRate = (successfulDivisions + 1) / (totalAttempts + 1) * 100;
              setSuccessRate(newSuccessRate);

              // Find position for the new daughter cell
              const newCellPosition = findAvailablePosition(grid, cell.position);

              // Reset original cell with isReset flag
              newCells.push({
                ...cell,
                stage: 'interphase',
                divisionProgress: 0,
                mutationLevel: 0,
                age: 0,
                isReset: true
              });

              // Create a daughter cell
              newCells.push({
                id: getNextCellId(),
                position: newCellPosition,
                stage: 'interphase',
                divisionProgress: 0,
                mutationLevel: 0,
                age: 0,
                isReset: true
              });
            } else {
              // Update the stage for cells not dividing
              newCells.push({
                ...cell,
                stage: nextStage,
                divisionProgress: 0,
                age: nextStage === 'interphase' ? cell.age + 1 : cell.age,
                mutationLevel: 0
              });
            }
          } else {
            // Simply update progress for cells not changing stage
            newCells.push({ ...cell, divisionProgress: nextProgress });
          }
        });

        // Update grid positions
        updateGridOccupancy(newCells.map(cell => cell.position));

        return newCells;
      });
    }, 100);

    return () => clearInterval(interval);
  }, [isPlaying, simulationSpeed, grid, updateGridOccupancy, getNextCellId, totalAttempts, successfulDivisions]);

  return (
    <div className="lab-container">
      {isLoading ? (
        <LoadingScreen />
      ) : (
        <>
          <div className="canvas-wrapper">
            <Canvas shadows camera={{ position: [20, 20, 20], fov: 50 }}>
              <Suspense fallback={null}>
                <ambientLight intensity={0.4} />
                <pointLight position={[10, 10, 10]} intensity={1.5} color="#ffffff" />
                <pointLight position={[-10, -10, -10]} intensity={0.8} color="#4a90e2" />
                <spotLight position={[0, 15, 0]} intensity={1.2} angle={0.3} penumbra={0.5} />

                <OrbitControls
                  enablePan={true}
                  enableZoom={true}
                  enableRotate={true}
                  minDistance={10}
                  maxDistance={50}
                  autoRotate={false}
                />

                <Environment preset="studio" />
                <gridHelper args={[100, 50, "#444444", "#222222"]} position={[0, -10, 0]} />

                <MitosisScene
                  cells={cells}
                  selectedCellId={selectedCellId}
                  onCellSelect={handleCellSelect}
                  simulationSpeed={simulationSpeed}
                />
              </Suspense>
            </Canvas>
            <button className="help-button" onClick={() => setShowTooltip(true)} aria-label="Show educational information">?</button>
          </div>

          <div className="ui-panel">
            <SimplifiedAnalyticsPanel
              successRate={successRate}
              totalAttempts={totalAttempts}
              successfulDivisions={successfulDivisions}
            />
            <AdvancedControlsPanel
              isPlaying={isPlaying}
              setIsPlaying={setIsPlaying}
              simulationSpeed={simulationSpeed}
              setSimulationSpeed={setSimulationSpeed}
              onReset={handleReset}
            />
            <CellInformationPanel selectedCell={selectedCell} />
          </div>

          <EducationalTooltip isOpen={showTooltip} onClose={() => setShowTooltip(false)} />
        </>
      )}

      <style jsx global>{`
        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }
        
        body {
          overflow: hidden;
          color: white;
        }
        
        .lab-container {
          display: flex;
          width: 100vw;
          height: 100vh;
          background: linear-gradient(135deg, #121218 0%, #1a1e2d 50%, #1a1f35 100%);
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
          overflow: hidden;
          color-scheme: dark;
          position: relative;
        }
        
        .canvas-wrapper {
          flex: 1;
          position: relative;
        }
        
        .help-button {
          position: absolute;
          bottom: 20px;
          left: 20px;
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: rgba(100, 120, 180, 0.4);
          color: white;
          font-size: 20px;
          font-weight: bold;
          border: none;
          cursor: pointer;
          z-index: 10;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
        }
        
        .help-button:hover {
          background: rgba(100, 120, 180, 0.6);
        }
        
        .ui-panel {
          width: 340px;
          overflow-y: auto;
          backdrop-filter: blur(10px);
          border-left: 1px solid rgba(120, 140, 190, 0.2);
          display: flex;
          flex-direction: column;
          gap: 20px;
          padding: 20px;
        }
        
        @media (max-width: 768px) {
          .lab-container {
            flex-direction: column;
          }
          
          .ui-panel {
            height: auto;
            width: 100%;
            max-height: 50vh;
            border-left: none;
            border-top: 1px solid rgba(120, 140, 190, 0.2);
          }
        }
        
        .analytics-panel, .controls-panel, .info-panel {
          background: rgba(30, 40, 65, 0.4);
          border: 1px solid rgba(120, 140, 190, 0.2);
          border-radius: 12px;
          padding: 20px;
          backdrop-filter: blur(10px);
        }
        
        .panel-title {
          color: white;
          font-size: 16px;
          font-weight: 600;
          margin-bottom: 16px;
          border-bottom: 1px solid rgba(120, 140, 190, 0.3);
          padding-bottom: 8px;
        }
        
        .metrics-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 12px;
          margin-bottom: 20px;
        }
        
        .metric-card {
          background: rgba(40, 50, 85, 0.4);
          border-radius: 8px;
          padding: 12px;
          text-align: center;
          transition: transform 0.2s ease;
        }
        
        .metric-card:hover {
          transform: translateY(-2px);
          background: rgba(50, 60, 95, 0.5);
        }
        
        .metric-value {
          font-size: 24px;
          font-weight: bold;
          color: white;
          margin-bottom: 4px;
        }
        
        .metric-label {
          font-size: 12px;
          color: rgba(255, 255, 255, 0.7);
        }
        
        .control-section {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        
        .control-row {
          display: flex;
          gap: 12px;
        }
        
        .control-btn {
          flex: 1;
          padding: 12px 16px;
          border: none;
          border-radius: 8px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
          font-size: 14px;
          background: rgba(80, 100, 150, 0.4);
          color: white;
        }
        
        .control-btn.primary {
          background: rgba(60, 90, 140, 0.6);
        }
        
        .control-btn.primary.active {
          background: rgba(180, 60, 60, 0.6);
        }
        
        .control-btn.secondary {
          background: rgba(60, 70, 100, 0.4);
        }
        
        .control-btn.export {
          background: rgba(40, 120, 80, 0.5);
        }
        
        .control-btn:hover {
          transform: translateY(-2px);
          filter: brightness(1.2);
        }
        
        .slider-control {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        
        .slider-control label {
          color: white;
          font-size: 14px;
        }
        
        .speed-slider {
          -webkit-appearance: none;
          height: 6px;
          border-radius: 3px;
          background: rgba(120, 140, 190, 0.3);
          outline: none;
        }
        
        .speed-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: rgba(100, 160, 230, 0.8);
          cursor: pointer;
        }
        
        .controls-options {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-top: 5px;
        }
        
        .checkbox-label {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 14px;
          color: white;
          cursor: pointer;
        }
        
        .checkbox-label input[type="checkbox"] {
          position: absolute;
          opacity: 0;
          cursor: pointer;
          height: 0;
          width: 0;
        }
        
        .checkmark {
          width: 18px;
          height: 18px;
          border: 2px solid rgba(100, 160, 230, 0.5);
          border-radius: 4px;
          position: relative;
          transition: all 0.2s ease;
          background: rgba(30, 40, 70, 0.4);
        }
        
        .checkbox-label input[type="checkbox"]:checked + .checkmark {
          background: rgba(100, 160, 230, 0.7);
        }
        
        .checkbox-label input[type="checkbox"]:checked + .checkmark::after {
          content: "✓";
          position: absolute;
          color: white;
          font-size: 12px;
          top: -2px;
          left: 2px;
        }
        
        .no-selection {
          color: rgba(255, 255, 255, 0.6);
          text-align: center;
          font-style: italic;
          padding: 20px;
        }
        
        .cell-overview {
          margin-bottom: 20px;
        }
        
        .stage-badge {
          background: linear-gradient(135deg, rgba(80, 120, 200, 0.6), rgba(120, 80, 180, 0.6));
          color: white;
          padding: 8px 16px;
          border-radius: 20px;
          font-size: 14px;
          font-weight: bold;
          display: inline-block;
          margin-bottom: 12px;
        }
        
        .stage-badge.failed {
          background: linear-gradient(135deg, rgba(200, 60, 60, 0.6), rgba(160, 40, 40, 0.6));
        }
        
        .progress-bar {
          height: 8px;
          background: rgba(80, 100, 150, 0.2);
          border-radius: 4px;
          overflow: hidden;
        }
        
        .progress-fill {
          height: 100%;
          background: linear-gradient(90deg, rgba(80, 120, 200, 0.8), rgba(40, 160, 120, 0.8));
          transition: width 0.5s ease;
        }
        
        .cell-stats {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin: 16px 0;
        }
        
        .stat-item {
          display: flex;
          justify-content: space-between;
        }
        
        .stat-label {
          color: rgba(255, 255, 255, 0.7);
          font-size: 14px;
        }
        
        .stat-value {
          color: white;
          font-weight: bold;
          font-size: 14px;
        }
        
        .failed-text {
          color: rgba(220, 80, 80, 0.9);
          font-weight: bold;
        }
        
        .stage-description {
          margin-bottom: 20px;
        }
        
        .stage-description h4 {
          color: white;
          margin-bottom: 8px;
          font-size: 15px;
        }
        
        .stage-description p {
          color: rgba(255, 255, 255, 0.8);
          line-height: 1.5;
          font-size: 14px;
        }
        
        .tooltip-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.7);
          display: flex;
          justify-content: center;
          align-items: center;
          z-index: 1000;
        }
        
        .tooltip-content {
          background: linear-gradient(135deg, #1a1f2d 0%, #1e2738 100%);
          border: 1px solid rgba(100, 130, 200, 0.3);
          border-radius: 12px;
          padding: 30px;
          max-width: 600px;
          width: 90%;
          max-height: 90vh;
          overflow-y: auto;
          position: relative;
          color: white;
        }
        
        .tooltip-close {
          position: absolute;
          top: 10px;
          right: 10px;
          background: transparent;
          border: none;
          color: rgba(255, 255, 255, 0.6);
          font-size: 24px;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        
        .tooltip-close:hover {
          color: white;
          transform: scale(1.1);
        }
        
        .tooltip-content h3 {
          color: white;
          margin-bottom: 16px;
          font-size: 24px;
        }
        
        .tooltip-content h4 {
          color: white;
          margin: 16px 0 8px;
          font-size: 18px;
        }
        
        .tooltip-content p {
          color: rgba(255, 255, 255, 0.8);
          line-height: 1.6;
          margin-bottom: 16px;
          font-size: 16px;
        }
        
        .tooltip-content ul {
          list-style-type: none;
          padding-left: 20px;
        }
        
        .tooltip-content li {
          color: rgba(255, 255, 255, 0.8);
          margin-bottom: 8px;
          line-height: 1.5;
        }
        
        .tooltip-content strong {
          color: white;
          font-weight: 600;
        }

        /* Loading screen styles */
        .loading-screen {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: linear-gradient(135deg, #121218 0%, #1a1e2d 50%, #1a1f35 100%);
          display: flex;
          justify-content: center;
          align-items: center;
          z-index: 1000;
        }
        
        .loading-container {
          text-align: center;
        }
        
        .loading-spinner {
          width: 60px;
          height: 60px;
          margin: 0 auto 20px;
          border: 4px solid rgba(255, 255, 255, 0.1);
          border-left-color: rgba(100, 160, 230, 0.8);
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }
        
        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }
        
        .loading-container h2 {
          color: white;
          font-size: 24px;
          margin-bottom: 10px;
        }
        
        .loading-container p {
          color: rgba(255, 255, 255, 0.7);
          font-size: 16px;
        }
      `}</style>
    </div>
  );
};

export default ImmersiveMitosisLab;